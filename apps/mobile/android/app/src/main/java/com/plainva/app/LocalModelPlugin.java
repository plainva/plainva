package com.plainva.app;

import ai.onnxruntime.NodeInfo;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONObject;

/**
 * Local model packages on Android (plan KI-Harness P2a-3, ADR 0021) — the
 * phone's twin of the desktop's model_store.rs and embedding.rs: a pinned
 * package file from huggingface.co into storage the system never backs up,
 * checked against its size and SHA-256; the model run in Microsoft's ONNX
 * Runtime; pooled vectors back to the WebView. Tokenizing stays in TypeScript.
 */
@CapacitorPlugin(name = "LocalModels")
public class LocalModelPlugin extends Plugin {

    private static final String MARKER = ".sha256";
    private static final String PART = ".part";
    private static final long PROGRESS_EVERY_MS = 250;

    /** Only the hub and its CDNs, over https: any other hop fails the download. */
    private static final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(false)
        .addNetworkInterceptor(chain -> {
            Request request = chain.request();
            if (!request.isHttps() || !LocalModelRules.allowedHost(request.url().host())) {
                throw new IOException("download_not_allowed");
            }
            return chain.proceed(request);
        })
        .build();

    private final ExecutorService downloads = Executors.newSingleThreadExecutor();
    /** One batch at a time: the runtime uses the cores itself. */
    private final ExecutorService inference = Executors.newSingleThreadExecutor();
    private final Map<String, AtomicBoolean> cancels = new ConcurrentHashMap<>();
    private final Map<String, OrtSession> sessions = new ConcurrentHashMap<>();
    private final AtomicLong next = new AtomicLong();

    private File modelsDir() {
        return new File(getContext().getNoBackupFilesDir(), "models");
    }

    private File modelFile(String model, String name) throws IOException {
        if (!LocalModelRules.validModel(model) || !LocalModelRules.validName(name)) throw new IOException("invalid model file");
        return new File(new File(modelsDir(), model), name);
    }

    private static File withSuffix(File file, String suffix) {
        return new File(file.getPath() + suffix);
    }

    private static boolean verified(File file, long bytes, String sha256) {
        if (!file.isFile() || file.length() != bytes) return false;
        try {
            return new String(readAll(withSuffix(file, MARKER)), StandardCharsets.UTF_8).trim().equals(sha256);
        } catch (IOException e) {
            return false;
        }
    }

    /** Whole-file reads and writes without java.nio.file, which needs Android 8 (minSdk is 24). */
    private static byte[] readAll(File file) throws IOException {
        try (InputStream in = new FileInputStream(file)) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream((int) Math.min(file.length(), Integer.MAX_VALUE));
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            return out.toByteArray();
        }
    }

    private static void writeAll(File file, byte[] bytes) throws IOException {
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
            out.getFD().sync();
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) out.append(String.format("%02x", b));
        return out.toString();
    }

    @PluginMethod
    public void status(PluginCall call) {
        try {
            String model = call.getString("model");
            JSArray files = call.getArray("files");
            JSArray out = new JSArray();
            for (int i = 0; i < files.length(); i++) {
                JSONObject file = files.getJSONObject(i);
                out.put(verified(modelFile(model, file.getString("name")), file.getLong("bytes"), file.getString("sha256")));
            }
            JSObject result = new JSObject();
            result.put("present", out);
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void download(PluginCall call) {
        String model = call.getString("model");
        String name = call.getString("name");
        String url = call.getString("url");
        String sha256 = call.getString("sha256");
        Long bytesValue = call.getLong("bytes");
        long bytes = bytesValue == null ? 0 : bytesValue;
        if (!LocalModelRules.validSha256(sha256) || bytes <= 0 || !LocalModelRules.allowedUrl(url, name)) {
            call.reject("download_not_allowed");
            return;
        }
        AtomicBoolean cancel = new AtomicBoolean(false);
        cancels.put(model, cancel);
        downloads.execute(() -> {
            try {
                fetch(model, name, url, bytes, sha256, cancel);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "download_failed" : e.getMessage());
            } finally {
                cancels.remove(model, cancel);
            }
        });
    }

    private void fetch(String model, String name, String url, long bytes, String sha256, AtomicBoolean cancel) throws Exception {
        File target = modelFile(model, name);
        if (verified(target, bytes, sha256)) return;
        File part = withSuffix(target, PART);
        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("cannot create " + parent);
        //noinspection ResultOfMethodCallIgnored
        withSuffix(target, MARKER).delete();
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long received = 0;
        if (part.isFile() && part.length() <= bytes) {
            try (InputStream in = new FileInputStream(part)) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    digest.update(buffer, 0, n);
                    received += n;
                }
            }
        } else {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
        }
        Request.Builder request = new Request.Builder().url(url);
        if (received > 0) request.header("Range", "bytes=" + received + "-");
        try (Response response = client.newCall(request.build()).execute()) {
            if (received > 0 && response.code() == 200) {
                digest.reset();
                received = 0;
            } else if (!(response.code() == 200 || (received > 0 && response.code() == 206))) {
                throw new IOException("download_failed: HTTP " + response.code());
            }
            long lastReport = 0;
            try (InputStream in = response.body().byteStream(); FileOutputStream out = new FileOutputStream(part, received > 0)) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    if (cancel.get()) throw new IOException("download_cancelled");
                    received += n;
                    if (received > bytes) {
                        //noinspection ResultOfMethodCallIgnored
                        part.delete();
                        throw new IOException("download_too_large");
                    }
                    digest.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                    long now = System.currentTimeMillis();
                    if (now - lastReport >= PROGRESS_EVERY_MS) {
                        lastReport = now;
                        progress(model, name, received);
                    }
                }
                out.getFD().sync();
            }
        }
        progress(model, name, received);
        String actual = hex(digest.digest());
        if (received != bytes || !actual.equals(sha256)) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            throw new IOException(received != bytes ? "download_incomplete" : "checksum_mismatch");
        }
        if (!part.renameTo(target)) throw new IOException("cannot move " + part);
        writeAll(withSuffix(target, MARKER), sha256.getBytes(StandardCharsets.UTF_8));
    }

    private void progress(String model, String name, long received) {
        JSObject event = new JSObject();
        event.put("model", model);
        event.put("name", name);
        event.put("received", received);
        notifyListeners("downloadProgress", event);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        AtomicBoolean flag = cancels.get(call.getString("model"));
        if (flag != null) flag.set(true);
        call.resolve();
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String model = call.getString("model");
        if (!LocalModelRules.validModel(model)) {
            call.reject("invalid model");
            return;
        }
        AtomicBoolean flag = cancels.get(model);
        if (flag != null) flag.set(true);
        deleteTree(new File(modelsDir(), model));
        call.resolve();
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    /** A checked file of a package: the marker says it passed its SHA-256. */
    private File checked(String model, String name) throws IOException {
        File file = modelFile(model, name);
        File marker = withSuffix(file, MARKER);
        if (!file.isFile() || !marker.isFile()) throw new IOException("model_unverified");
        String sha = new String(readAll(marker), StandardCharsets.UTF_8).trim();
        if (!LocalModelRules.validSha256(sha)) throw new IOException("model_unverified");
        return file;
    }

    @PluginMethod
    public void readText(PluginCall call) {
        downloads.execute(() -> {
            try {
                File file = checked(call.getString("model"), call.getString("name"));
                JSObject result = new JSObject();
                result.put("text", new String(readAll(file), StandardCharsets.UTF_8));
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void load(PluginCall call) {
        String relative = call.getString("model", "");
        inference.execute(() -> {
            try {
                int slash = relative.indexOf('/');
                if (slash < 0) throw new IOException("invalid model file");
                File file = checked(relative.substring(0, slash), relative.substring(slash + 1));
                OrtEnvironment env = OrtEnvironment.getEnvironment();
                OrtSession.SessionOptions options = new OrtSession.SessionOptions();
                options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
                options.setIntraOpNumThreads(Math.max(1, Runtime.getRuntime().availableProcessors() / 2));
                String handle = "m" + next.incrementAndGet();
                sessions.put(handle, env.createSession(file.getPath(), options));
                JSObject result = new JSObject();
                result.put("handle", handle);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("model_load: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void unload(PluginCall call) {
        String handle = call.getString("handle", "");
        inference.execute(() -> {
            OrtSession session = sessions.remove(handle);
            try {
                if (session != null) session.close();
            } catch (OrtException ignored) {
                // Closing twice or after a failed load leaves nothing to free.
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void run(PluginCall call) {
        inference.execute(() -> {
            try {
                OrtSession session = sessions.get(call.getString("handle", ""));
                if (session == null) throw new IOException("model_not_loaded");
                int batch = call.getInt("batch", 0);
                int seq = call.getInt("seq", 0);
                String pooling = call.getString("pooling", LocalModelRules.POOL_CLS);
                byte[] idBytes = Base64.decode(call.getString("ids", ""), Base64.DEFAULT);
                byte[] mask = Base64.decode(call.getString("mask", ""), Base64.DEFAULT);
                if (batch <= 0 || seq <= 0 || idBytes.length != batch * seq * 4 || mask.length != batch * seq) {
                    throw new IOException("batch shape");
                }
                ByteBuffer idBuffer = ByteBuffer.wrap(idBytes).order(ByteOrder.LITTLE_ENDIAN);
                long[] ids = new long[batch * seq];
                long[] mask64 = new long[batch * seq];
                for (int i = 0; i < ids.length; i++) {
                    ids[i] = idBuffer.getInt();
                    mask64[i] = mask[i] != 0 ? 1 : 0;
                }
                float[] pooled;
                int dim;
                OrtEnvironment env = OrtEnvironment.getEnvironment();
                Map<String, OnnxTensor> inputs = new HashMap<>();
                try {
                    long[] shape = { batch, seq };
                    for (Map.Entry<String, NodeInfo> input : session.getInputInfo().entrySet()) {
                        String name = input.getKey();
                        if (name.equals("input_ids")) inputs.put(name, OnnxTensor.createTensor(env, LongBuffer.wrap(ids), shape));
                        else if (name.equals("attention_mask")) inputs.put(name, OnnxTensor.createTensor(env, LongBuffer.wrap(mask64), shape));
                        else if (name.equals("position_ids")) {
                            long[] positions = new long[batch * seq];
                            for (int i = 0; i < positions.length; i++) positions[i] = i % seq;
                            inputs.put(name, OnnxTensor.createTensor(env, LongBuffer.wrap(positions), shape));
                        } else if (name.equals("token_type_ids")) {
                            inputs.put(name, OnnxTensor.createTensor(env, LongBuffer.wrap(new long[batch * seq]), shape));
                        } else if (name.startsWith("past_key_values") && input.getValue().getInfo() instanceof TensorInfo) {
                            long[] empty = LocalModelRules.cacheShape(((TensorInfo) input.getValue().getInfo()).getShape(), batch);
                            inputs.put(name, OnnxTensor.createTensor(env, FloatBuffer.allocate(0), empty));
                        } else {
                            throw new IOException("model input " + name + " is not supported");
                        }
                    }
                    try (OrtSession.Result result = session.run(inputs)) {
                        OnnxValue value = result.get("last_hidden_state").orElseThrow(() -> new IOException("model has no last_hidden_state"));
                        OnnxTensor hidden = (OnnxTensor) value;
                        long[] outShape = ((TensorInfo) hidden.getInfo()).getShape();
                        if (outShape.length != 3 || outShape[0] != batch || outShape[1] != seq) throw new IOException("unexpected output shape");
                        dim = (int) outShape[2];
                        FloatBuffer data = hidden.getFloatBuffer();
                        float[] all = new float[data.remaining()];
                        data.get(all);
                        pooled = LocalModelRules.pool(all, mask, batch, seq, dim, pooling);
                    }
                } finally {
                    for (OnnxTensor tensor : inputs.values()) tensor.close();
                }
                ByteBuffer out = ByteBuffer.allocate(pooled.length * 4).order(ByteOrder.LITTLE_ENDIAN);
                for (float v : pooled) out.putFloat(v);
                JSObject result = new JSObject();
                result.put("vectors", Base64.encodeToString(out.array(), Base64.NO_WRAP));
                result.put("dim", dim);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("model_run: " + e.getMessage());
            }
        });
    }
}
