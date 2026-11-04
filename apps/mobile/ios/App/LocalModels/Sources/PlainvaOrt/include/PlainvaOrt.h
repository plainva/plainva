// The ONNX Runtime seam of the iOS app (plan KI-Harness P2a-3, ADR 0021): the
// same contract as the desktop's embedding.rs and the Android plugin — load a
// model, run a padded batch of token ids, get pooled vectors back. A small C
// layer over Microsoft's C API, so Swift never handles its raw structures.

#ifndef PLAINVA_ORT_H
#define PLAINVA_ORT_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct PlainvaOrtSession PlainvaOrtSession;

enum { PLAINVA_POOL_CLS = 0, PLAINVA_POOL_LAST = 1, PLAINVA_POOL_MEAN = 2 };

/// Loads a model file. NULL on failure, with `*error` set (free it with `plainva_ort_free`).
PlainvaOrtSession *plainva_ort_load(const char *model_path, int intra_threads, char **error);

/// Runs `batch × seq` ids (padded on the right, `mask` 1 for a token) and writes
/// `batch × *dim` pooled floats to `*vectors` (free with `plainva_ort_free`).
/// Returns 0 on success; otherwise `*error` says why.
int plainva_ort_run(PlainvaOrtSession *session, const int32_t *ids, const uint8_t *mask, int64_t batch, int64_t seq, int pooling,
                    float **vectors, int64_t *dim, char **error);

void plainva_ort_unload(PlainvaOrtSession *session);

void plainva_ort_free(void *pointer);

/// `batch × seq × dim` hidden states to `batch × dim`: the first token, the last unmasked one, or the masked mean.
void plainva_ort_pool(const float *hidden, const uint8_t *mask, int64_t batch, int64_t seq, int64_t dim, int pooling, float *out);

#ifdef __cplusplus
}
#endif

#endif
