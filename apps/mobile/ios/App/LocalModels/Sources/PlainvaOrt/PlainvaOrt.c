// See PlainvaOrt.h. The model's other inputs are filled from its own
// description, as in every shell: position ids 0…seq-1, token type ids 0, and
// an empty cache (past length 0) for decoder exports that take one.

#include "PlainvaOrt.h"

#include <onnxruntime/onnxruntime_c_api.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct PlainvaOrtSession {
    OrtSession *session;
};

static const OrtApi *ort_api = NULL;
static OrtEnv *ort_env = NULL;
static char *ort_init_error = NULL;
static pthread_once_t ort_once = PTHREAD_ONCE_INIT;

static void init_runtime(void) {
    ort_api = OrtGetApiBase()->GetApi(ORT_API_VERSION);
    if (!ort_api) {
        ort_init_error = strdup("runtime_load: API version not available");
        return;
    }
    OrtStatus *status = ort_api->CreateEnv(ORT_LOGGING_LEVEL_WARNING, "plainva", &ort_env);
    if (status) {
        ort_init_error = strdup(ort_api->GetErrorMessage(status));
        ort_api->ReleaseStatus(status);
        ort_env = NULL;
    }
}

static int ready(char **error) {
    pthread_once(&ort_once, init_runtime);
    if (ort_env) return 1;
    if (error) *error = strdup(ort_init_error ? ort_init_error : "runtime_load");
    return 0;
}

/// Takes a status: 0 when there was none, else 1 with the message in `*error`.
static int failed(OrtStatus *status, char **error) {
    if (!status) return 0;
    if (error && !*error) *error = strdup(ort_api->GetErrorMessage(status));
    ort_api->ReleaseStatus(status);
    return 1;
}

static void set_error(char **error, const char *message, const char *detail) {
    if (!error || *error) return;
    size_t length = strlen(message) + (detail ? strlen(detail) : 0) + 2;
    *error = malloc(length);
    if (*error) snprintf(*error, length, detail ? "%s %s" : "%s", message, detail);
}

PlainvaOrtSession *plainva_ort_load(const char *model_path, int intra_threads, char **error) {
    if (error) *error = NULL;
    if (!ready(error)) return NULL;
    OrtSessionOptions *options = NULL;
    OrtSession *session = NULL;
    if (failed(ort_api->CreateSessionOptions(&options), error)) return NULL;
    int ok = !(intra_threads > 0 && failed(ort_api->SetIntraOpNumThreads(options, intra_threads), error)) &&
             !failed(ort_api->SetSessionGraphOptimizationLevel(options, ORT_ENABLE_ALL), error) &&
             !failed(ort_api->CreateSession(ort_env, model_path, options, &session), error);
    ort_api->ReleaseSessionOptions(options);
    if (!ok) return NULL;
    PlainvaOrtSession *out = calloc(1, sizeof *out);
    if (!out) {
        ort_api->ReleaseSession(session);
        set_error(error, "out of memory", NULL);
        return NULL;
    }
    out->session = session;
    return out;
}

void plainva_ort_unload(PlainvaOrtSession *session) {
    if (!session) return;
    if (session->session) ort_api->ReleaseSession(session->session);
    free(session);
}

void plainva_ort_free(void *pointer) {
    free(pointer);
}

void plainva_ort_pool(const float *hidden, const uint8_t *mask, int64_t batch, int64_t seq, int64_t dim, int pooling, float *out) {
    for (int64_t b = 0; b < batch; b++) {
        float *target = out + b * dim;
        if (pooling == PLAINVA_POOL_MEAN) {
            memset(target, 0, (size_t)dim * sizeof(float));
            int64_t count = 0;
            for (int64_t t = 0; t < seq; t++) {
                if (!mask[b * seq + t]) continue;
                count++;
                const float *row = hidden + (b * seq + t) * dim;
                for (int64_t d = 0; d < dim; d++) target[d] += row[d];
            }
            if (count > 0)
                for (int64_t d = 0; d < dim; d++) target[d] /= (float)count;
        } else {
            int64_t token = 0;
            if (pooling == PLAINVA_POOL_LAST)
                for (int64_t t = seq - 1; t >= 0; t--)
                    if (mask[b * seq + t]) {
                        token = t;
                        break;
                    }
            memcpy(target, hidden + (b * seq + token) * dim, (size_t)dim * sizeof(float));
        }
    }
}

int plainva_ort_run(PlainvaOrtSession *session, const int32_t *ids, const uint8_t *mask, int64_t batch, int64_t seq, int pooling,
                    float **vectors, int64_t *dim, char **error) {
    if (error) *error = NULL;
    *vectors = NULL;
    *dim = 0;
    if (!session || !ready(error)) return 1;
    if (batch <= 0 || seq <= 0) {
        set_error(error, "batch shape", NULL);
        return 1;
    }
    const int64_t cells = batch * seq;
    int result = 1;
    OrtAllocator *allocator = NULL;
    OrtMemoryInfo *memory = NULL;
    OrtValue *output = NULL;
    size_t count = 0;
    char **names = NULL;
    OrtValue **values = NULL;
    int64_t *ids64 = malloc((size_t)cells * sizeof(int64_t));
    int64_t *mask64 = malloc((size_t)cells * sizeof(int64_t));
    int64_t *positions = malloc((size_t)cells * sizeof(int64_t));
    int64_t *zeros = calloc((size_t)cells, sizeof(int64_t));
    // A zero-length tensor still needs a pointer; it is never read.
    static float nothing = 0;
    if (!ids64 || !mask64 || !positions || !zeros) {
        set_error(error, "out of memory", NULL);
        goto done;
    }
    for (int64_t i = 0; i < cells; i++) {
        ids64[i] = ids[i];
        mask64[i] = mask[i] ? 1 : 0;
        positions[i] = i % seq;
    }
    if (failed(ort_api->GetAllocatorWithDefaultOptions(&allocator), error)) goto done;
    if (failed(ort_api->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &memory), error)) goto done;
    if (failed(ort_api->SessionGetInputCount(session->session, &count), error)) goto done;
    names = calloc(count, sizeof(char *));
    values = calloc(count, sizeof(OrtValue *));
    if (!names || !values) {
        set_error(error, "out of memory", NULL);
        goto done;
    }
    const int64_t shape[2] = {batch, seq};
    for (size_t i = 0; i < count; i++) {
        if (failed(ort_api->SessionGetInputName(session->session, i, allocator, &names[i]), error)) goto done;
        const char *name = names[i];
        int64_t *data = NULL;
        if (strcmp(name, "input_ids") == 0) data = ids64;
        else if (strcmp(name, "attention_mask") == 0) data = mask64;
        else if (strcmp(name, "position_ids") == 0) data = positions;
        else if (strcmp(name, "token_type_ids") == 0) data = zeros;
        if (data) {
            if (failed(ort_api->CreateTensorWithDataAsOrtValue(memory, data, (size_t)cells * sizeof(int64_t), shape, 2,
                                                               ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64, &values[i]),
                       error))
                goto done;
            continue;
        }
        if (strncmp(name, "past_key_values", 15) != 0) {
            set_error(error, "model input is not supported:", name);
            goto done;
        }
        OrtTypeInfo *type = NULL;
        const OrtTensorTypeAndShapeInfo *tensor = NULL;
        size_t rank = 0;
        int64_t dims[8];
        if (failed(ort_api->SessionGetInputTypeInfo(session->session, i, &type), error)) goto done;
        int ok = !failed(ort_api->CastTypeInfoToTensorInfo(type, &tensor), error) && tensor &&
                 !failed(ort_api->GetDimensionsCount(tensor, &rank), error) && rank > 0 && rank <= 8 &&
                 !failed(ort_api->GetDimensions(tensor, dims, rank), error);
        ort_api->ReleaseTypeInfo(type);
        if (!ok) {
            set_error(error, "model input has no usable shape:", name);
            goto done;
        }
        // The batch first, the model's fixed sizes, and 0 for every other open size — the past length.
        for (size_t d = 0; d < rank; d++) dims[d] = d == 0 ? batch : dims[d] >= 0 ? dims[d] : 0;
        if (failed(ort_api->CreateTensorWithDataAsOrtValue(memory, &nothing, 0, dims, rank, ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &values[i]),
                   error))
            goto done;
    }
    const char *output_names[1] = {"last_hidden_state"};
    if (failed(ort_api->Run(session->session, NULL, (const char *const *)names, (const OrtValue *const *)values, count, output_names, 1, &output),
               error))
        goto done;
    OrtTensorTypeAndShapeInfo *info = NULL;
    size_t rank = 0;
    int64_t out_shape[3] = {0, 0, 0};
    if (failed(ort_api->GetTensorTypeAndShape(output, &info), error)) goto done;
    int shaped = !failed(ort_api->GetDimensionsCount(info, &rank), error) && rank == 3 && !failed(ort_api->GetDimensions(info, out_shape, 3), error);
    ort_api->ReleaseTensorTypeAndShapeInfo(info);
    if (!shaped || out_shape[0] != batch || out_shape[1] != seq || out_shape[2] <= 0) {
        set_error(error, "unexpected output shape", NULL);
        goto done;
    }
    float *hidden = NULL;
    if (failed(ort_api->GetTensorMutableData(output, (void **)&hidden), error)) goto done;
    float *pooled = malloc((size_t)(batch * out_shape[2]) * sizeof(float));
    if (!pooled) {
        set_error(error, "out of memory", NULL);
        goto done;
    }
    plainva_ort_pool(hidden, mask, batch, seq, out_shape[2], pooling, pooled);
    *vectors = pooled;
    *dim = out_shape[2];
    result = 0;
done:
    if (output) ort_api->ReleaseValue(output);
    if (values)
        for (size_t i = 0; i < count; i++)
            if (values[i]) ort_api->ReleaseValue(values[i]);
    if (names)
        for (size_t i = 0; i < count; i++)
            if (names[i]) ort_api->AllocatorFree(allocator, names[i]);
    free(values);
    free(names);
    if (memory) ort_api->ReleaseMemoryInfo(memory);
    free(ids64);
    free(mask64);
    free(positions);
    free(zeros);
    if (result != 0 && error && !*error) *error = strdup("model_run");
    return result;
}
