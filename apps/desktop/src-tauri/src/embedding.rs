//! Local embeddings on the desktop (plan KI-Harness P2a-3, ADR 0021): Microsoft's ONNX
//! Runtime, loaded at run time from the library the app bundle carries, runs a model
//! package the user downloaded (`model_store.rs`). The interface is the one every shell
//! offers (`OnnxEmbeddingRunner` in packages/core): load a model, run a padded batch of
//! token ids, get pooled vectors back. Tokenizing stays in TypeScript.
//!
//! The model's other inputs are filled here, from the model's own description: position
//! ids 0…seq-1, token type ids 0, and an empty cache for decoder exports that carry one
//! (Qwen3 Embedding takes `past_key_values.*` of past length 0).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use ort::session::builder::GraphOptimizationLevel;
use ort::session::{Session, SessionInputValue};
use ort::value::{Tensor, TensorElementType, ValueType};
use tauri::{AppHandle, Manager, State};

use crate::model_store;

/// Loaded models by handle. A session runs one batch at a time (`run` takes `&mut`).
#[derive(Default)]
pub struct Embeddings {
    sessions: Mutex<HashMap<String, Arc<Mutex<Session>>>>,
    next: AtomicU64,
}

/// The runtime is loaded once per process; a failure is remembered, not retried per call.
static RUNTIME: OnceLock<Result<(), String>> = OnceLock::new();

#[cfg(target_os = "windows")]
const LIBRARY: &str = "onnxruntime.dll";
#[cfg(target_os = "macos")]
const LIBRARY: &str = "libonnxruntime.dylib";
#[cfg(all(unix, not(target_os = "macos")))]
const LIBRARY: &str = "libonnxruntime.so";

/// Where the runtime library is, first match wins: a development override, the app
/// bundle (macOS: `Contents/Frameworks`, signed with the app; elsewhere the resources),
/// and in a development build the copy `scripts/fetch-onnxruntime.mjs` put in the source tree.
fn library_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut out = Vec::new();
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("PLAINVA_ONNXRUNTIME") {
        out.push(PathBuf::from(path));
    }
    #[cfg(target_os = "macos")]
    if let Some(dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|p| p.to_path_buf())) {
        out.push(dir.join("../Frameworks").join(LIBRARY));
    }
    if let Ok(dir) = app.path().resource_dir() {
        out.push(dir.join("onnxruntime").join(LIBRARY));
    }
    #[cfg(debug_assertions)]
    out.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("onnxruntime").join(LIBRARY));
    out
}

fn ensure_runtime(app: &AppHandle) -> Result<(), String> {
    RUNTIME
        .get_or_init(|| {
            let candidates = library_candidates(app);
            let Some(path) = candidates.iter().find(|path| path.is_file()) else {
                return Err(format!("runtime_missing: {}", candidates.first().map(|p| p.display().to_string()).unwrap_or_default()));
            };
            ort::init_from(path).map_err(|e| format!("runtime_load: {e}"))?.with_name("plainva").commit();
            Ok(())
        })
        .clone()
}

fn only_main(window: &tauri::Window) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("local models run in the main window only".into())
    }
}

/// Threads for one batch: half the machine, so typing stays smooth while notes embed.
fn intra_threads() -> usize {
    std::thread::available_parallelism().map(|n| (n.get() / 2).max(1)).unwrap_or(1)
}

#[tauri::command]
pub async fn embedding_load(window: tauri::Window, app: AppHandle, state: State<'_, Embeddings>, model: String) -> Result<String, String> {
    only_main(&window)?;
    ensure_runtime(&app)?;
    let path = model_store::verified_file(&app, &model)?;
    let session = tauri::async_runtime::spawn_blocking(move || {
        let build = || -> ort::Result<Session> {
            Session::builder()?
                .with_optimization_level(GraphOptimizationLevel::Level3)?
                .with_intra_threads(intra_threads())?
                .commit_from_file(&path)
        };
        build().map_err(|e| format!("model_load: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    let handle = format!("m{}", state.next.fetch_add(1, Ordering::Relaxed));
    state.sessions.lock().map_err(|e| e.to_string())?.insert(handle.clone(), Arc::new(Mutex::new(session)));
    Ok(handle)
}

#[tauri::command]
pub fn embedding_unload(window: tauri::Window, state: State<'_, Embeddings>, handle: String) -> Result<(), String> {
    only_main(&window)?;
    state.sessions.lock().map_err(|e| e.to_string())?.remove(&handle);
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingBatch {
    /// `batch × seq` token ids, Int32 little-endian, base64.
    ids: String,
    /// `batch × seq` attention mask, one byte each, base64.
    mask: String,
    batch: usize,
    seq: usize,
    pooling: Pooling,
}

#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Pooling {
    Cls,
    Last,
    Mean,
}

/// Pooled vectors, `batch × dim` Float32 little-endian, base64 — not yet normalised.
#[derive(serde::Serialize)]
pub struct EmbeddingResult {
    vectors: String,
    dim: usize,
}

#[tauri::command]
pub async fn embedding_run(window: tauri::Window, state: State<'_, Embeddings>, handle: String, request: EmbeddingBatch) -> Result<EmbeddingResult, String> {
    only_main(&window)?;
    let session = state.sessions.lock().map_err(|e| e.to_string())?.get(&handle).cloned().ok_or("model_not_loaded")?;
    let ids = decode_i32(&request.ids)?;
    let mask = STANDARD.decode(&request.mask).map_err(|e| e.to_string())?;
    let cells = request.batch.checked_mul(request.seq).ok_or("batch too large")?;
    if request.batch == 0 || request.seq == 0 || ids.len() != cells || mask.len() != cells {
        return Err(format!("batch shape: {} ids and {} mask bytes for {} × {}", ids.len(), mask.len(), request.batch, request.seq));
    }
    let (vectors, dim) = tauri::async_runtime::spawn_blocking(move || {
        let mut session = session.lock().map_err(|e| e.to_string())?;
        run_batch(&mut session, &ids, &mask, request.batch, request.seq, request.pooling)
    })
    .await
    .map_err(|e| e.to_string())??;
    let mut bytes = Vec::with_capacity(vectors.len() * 4);
    for value in vectors {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    Ok(EmbeddingResult { vectors: STANDARD.encode(bytes), dim })
}

fn decode_i32(text: &str) -> Result<Vec<i64>, String> {
    let bytes = STANDARD.decode(text).map_err(|e| e.to_string())?;
    if bytes.len() % 4 != 0 {
        return Err("ids are not whole Int32 values".into());
    }
    Ok(bytes.chunks_exact(4).map(|b| i64::from(i32::from_le_bytes([b[0], b[1], b[2], b[3]]))).collect())
}

/// One input the batch does not bring itself, from the model's description.
fn filler(name: &str, dtype: &ValueType, batch: usize, seq: usize) -> Result<SessionInputValue<'static>, String> {
    let ValueType::Tensor { ty, shape, .. } = dtype else {
        return Err(format!("model input {name} is not a tensor"));
    };
    match (name, ty) {
        ("position_ids", TensorElementType::Int64) => {
            let values: Vec<i64> = (0..batch).flat_map(|_| 0..seq as i64).collect();
            Ok(Tensor::from_array(([batch, seq], values)).map_err(|e| e.to_string())?.into())
        }
        ("token_type_ids", TensorElementType::Int64) => Ok(Tensor::from_array(([batch, seq], vec![0i64; batch * seq])).map_err(|e| e.to_string())?.into()),
        (_, TensorElementType::Float32) if name.starts_with("past_key_values") => {
            Ok(Tensor::from_array((cache_shape(shape, batch), Vec::<f32>::new())).map_err(|e| e.to_string())?.into())
        }
        _ => Err(format!("model input {name} is not supported")),
    }
}

/// The shape of an empty cache: the batch first, the model's fixed sizes, and 0 for every
/// other open size — the past length. The same rule in every shell.
fn cache_shape(shape: &[i64], batch: usize) -> Vec<usize> {
    shape
        .iter()
        .enumerate()
        .map(|(i, &dim)| if i == 0 { batch } else if dim >= 0 { dim as usize } else { 0 })
        .collect()
}

fn run_batch(session: &mut Session, ids: &[i64], mask: &[u8], batch: usize, seq: usize, pooling: Pooling) -> Result<(Vec<f32>, usize), String> {
    let mask64: Vec<i64> = mask.iter().map(|&m| i64::from(m != 0)).collect();
    let mut inputs: Vec<(String, SessionInputValue<'static>)> = Vec::new();
    for input in session.inputs() {
        let value: SessionInputValue<'static> = match input.name() {
            "input_ids" => Tensor::from_array(([batch, seq], ids.to_vec())).map_err(|e| e.to_string())?.into(),
            "attention_mask" => Tensor::from_array(([batch, seq], mask64.clone())).map_err(|e| e.to_string())?.into(),
            name => filler(name, input.dtype(), batch, seq)?,
        };
        inputs.push((input.name().to_string(), value));
    }
    let outputs = session.run(inputs).map_err(|e| format!("model_run: {e}"))?;
    let hidden = outputs.get("last_hidden_state").ok_or("model has no last_hidden_state")?;
    let (shape, data) = hidden.try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
    if shape.len() != 3 || shape[0] as usize != batch || shape[1] as usize != seq {
        return Err(format!("unexpected output shape {:?}", &shape[..]));
    }
    let dim = shape[2] as usize;
    Ok((pool(data, mask, batch, seq, dim, pooling), dim))
}

/// `batch × seq × dim` hidden states to `batch × dim`: the first token, the last
/// unmasked one, or the masked mean.
pub fn pool(hidden: &[f32], mask: &[u8], batch: usize, seq: usize, dim: usize, pooling: Pooling) -> Vec<f32> {
    let mut out = vec![0f32; batch * dim];
    for b in 0..batch {
        let row = &mask[b * seq..(b + 1) * seq];
        let at = |t: usize| &hidden[(b * seq + t) * dim..(b * seq + t + 1) * dim];
        let target = &mut out[b * dim..(b + 1) * dim];
        match pooling {
            Pooling::Cls => target.copy_from_slice(at(0)),
            Pooling::Last => {
                let last = row.iter().rposition(|&m| m != 0).unwrap_or(0);
                target.copy_from_slice(at(last));
            }
            Pooling::Mean => {
                let mut count = 0f32;
                for (t, &m) in row.iter().enumerate() {
                    if m == 0 {
                        continue;
                    }
                    count += 1.0;
                    for (acc, v) in target.iter_mut().zip(at(t)) {
                        *acc += v;
                    }
                }
                if count > 0.0 {
                    for acc in target.iter_mut() {
                        *acc /= count;
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // Two rows of three tokens, dim 2; the second row is padded after two tokens.
    const HIDDEN: [f32; 12] = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0];
    const MASK: [u8; 6] = [1, 1, 1, 1, 1, 0];

    #[test]
    fn cls_takes_the_first_token() {
        assert_eq!(pool(&HIDDEN, &MASK, 2, 3, 2, Pooling::Cls), vec![1.0, 2.0, 7.0, 8.0]);
    }

    #[test]
    fn last_takes_the_last_unmasked_token() {
        assert_eq!(pool(&HIDDEN, &MASK, 2, 3, 2, Pooling::Last), vec![5.0, 6.0, 9.0, 10.0]);
    }

    #[test]
    fn mean_leaves_padding_out() {
        assert_eq!(pool(&HIDDEN, &MASK, 2, 3, 2, Pooling::Mean), vec![3.0, 4.0, 8.0, 9.0]);
    }

    #[test]
    fn an_empty_cache_keeps_fixed_sizes_and_drops_the_past() {
        assert_eq!(cache_shape(&[-1, 8, -1, 128], 3), vec![3, 8, 0, 128]);
    }

    #[test]
    fn ids_travel_as_int32() {
        let bytes: Vec<u8> = [5i32, -1, 250_000].iter().flat_map(|v| v.to_le_bytes()).collect();
        assert_eq!(decode_i32(&STANDARD.encode(bytes)).unwrap(), vec![5, -1, 250_000]);
        assert!(decode_i32(&STANDARD.encode([1u8, 2, 3])).is_err());
    }

    /// The shipped code path against the real runtime and a real model, run by hand
    /// (`cargo test -- --ignored golden`): PLAINVA_ORT_LIB (the library), PLAINVA_ORT_MODEL,
    /// PLAINVA_ORT_IDS (the probe's ids), PLAINVA_ORT_POOLING and PLAINVA_ORT_HEAD (the
    /// catalog's reference). One row, as the engine always runs.
    #[test]
    #[ignore = "needs the ONNX Runtime library and a model file"]
    fn golden_against_the_real_runtime() {
        let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name} not set"));
        let numbers = |text: String| text.split(',').map(|x| x.trim().to_string()).collect::<Vec<_>>();
        ort::init_from(var("PLAINVA_ORT_LIB")).unwrap().with_name("golden").commit();
        let mut session = Session::builder().unwrap().commit_from_file(var("PLAINVA_ORT_MODEL")).unwrap();
        let ids: Vec<i64> = numbers(var("PLAINVA_ORT_IDS")).iter().map(|x| x.parse().unwrap()).collect();
        let head: Vec<f32> = numbers(var("PLAINVA_ORT_HEAD")).iter().map(|x| x.parse().unwrap()).collect();
        let pooling = match var("PLAINVA_ORT_POOLING").as_str() {
            "last" => Pooling::Last,
            "mean" => Pooling::Mean,
            _ => Pooling::Cls,
        };
        let mask = vec![1u8; ids.len()];
        let (vector, dim) = run_batch(&mut session, &ids, &mask, 1, ids.len(), pooling).unwrap();
        assert_eq!(vector.len(), dim);
        let norm = vector.iter().map(|x| x * x).sum::<f32>().sqrt();
        let got: Vec<f32> = vector[..head.len()].iter().map(|x| x / norm).collect();
        let delta = got.iter().zip(&head).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
        assert!(delta < 1e-4, "head {got:?} differs from the reference by {delta}");
    }
}
