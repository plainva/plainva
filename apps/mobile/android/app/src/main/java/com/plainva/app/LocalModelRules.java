package com.plainva.app;

import java.net.URI;
import java.util.Locale;

/**
 * The model packages' rules that are plain functions (plan KI-Harness P2a-3),
 * kept apart from the plugin so a JUnit test holds them without a device —
 * the same rules as the desktop's model_store.rs and embedding.rs.
 */
final class LocalModelRules {
    private LocalModelRules() {}

    static final String POOL_CLS = "cls";
    static final String POOL_LAST = "last";
    static final String POOL_MEAN = "mean";

    /** A catalog id: lower-case letters, digits, dots and dashes. */
    static boolean validModel(String model) {
        if (model == null || model.isEmpty() || model.length() > 64 || model.startsWith(".")) return false;
        for (char c : model.toCharArray()) {
            if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-')) return false;
        }
        return true;
    }

    /** A repository path: plain segments joined by '/', none of them "." or "..". */
    static boolean validName(String name) {
        if (name == null || name.isEmpty() || name.length() > 200) return false;
        for (String part : name.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) return false;
            for (char c : part.toCharArray()) {
                if (!(Character.isLetterOrDigit(c) && c < 128) && c != '.' && c != '_' && c != '-') return false;
            }
        }
        return true;
    }

    static boolean validSha256(String sha) {
        if (sha == null || sha.length() != 64) return false;
        for (char c : sha.toCharArray()) {
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        return true;
    }

    /** Hosts a package download may reach: the hub, and the download CDNs it redirects to. */
    static boolean allowedHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(Locale.ROOT);
        return h.equals("huggingface.co") || h.endsWith(".huggingface.co") || h.endsWith(".hf.co");
    }

    /** The request must be the pinned file of a package: the hub, a commit, the named file. */
    static boolean allowedUrl(String url, String name) {
        try {
            URI uri = new URI(url);
            if (!"https".equals(uri.getScheme()) || !"huggingface.co".equals(uri.getHost()) || uri.getRawQuery() != null || uri.getPort() != -1) return false;
            String path = uri.getRawPath();
            int at = path == null ? -1 : path.indexOf("/resolve/");
            if (at < 0) return false;
            String tail = path.substring(at + "/resolve/".length());
            int slash = tail.indexOf('/');
            if (slash != 40) return false;
            for (char c : tail.substring(0, 40).toCharArray()) {
                if (Character.digit(c, 16) < 0) return false;
            }
            return tail.substring(41).equals(name);
        } catch (Exception e) {
            return false;
        }
    }

    /** The shape of an empty cache: the batch first, fixed sizes kept, every other open size 0. */
    static long[] cacheShape(long[] shape, int batch) {
        long[] out = new long[shape.length];
        for (int i = 0; i < shape.length; i++) out[i] = i == 0 ? batch : shape[i] >= 0 ? shape[i] : 0;
        return out;
    }

    /**
     * {@code batch × seq × dim} hidden states to {@code batch × dim}: the first
     * token, the last unmasked one, or the masked mean.
     */
    static float[] pool(float[] hidden, byte[] mask, int batch, int seq, int dim, String pooling) {
        float[] out = new float[batch * dim];
        for (int b = 0; b < batch; b++) {
            if (POOL_MEAN.equals(pooling)) {
                int count = 0;
                for (int t = 0; t < seq; t++) {
                    if (mask[b * seq + t] == 0) continue;
                    count++;
                    for (int d = 0; d < dim; d++) out[b * dim + d] += hidden[(b * seq + t) * dim + d];
                }
                if (count > 0) for (int d = 0; d < dim; d++) out[b * dim + d] /= count;
            } else {
                int token = 0;
                if (POOL_LAST.equals(pooling)) {
                    for (int t = seq - 1; t >= 0; t--) {
                        if (mask[b * seq + t] != 0) {
                            token = t;
                            break;
                        }
                    }
                }
                System.arraycopy(hidden, (b * seq + token) * dim, out, b * dim, dim);
            }
        }
        return out;
    }
}
