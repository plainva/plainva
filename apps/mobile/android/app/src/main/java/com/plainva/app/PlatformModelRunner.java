package com.plainva.app;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.common.GenAiException;
import com.google.mlkit.genai.common.StreamingCallback;
import com.google.mlkit.genai.prompt.GenerateContentRequest;
import com.google.mlkit.genai.prompt.GenerateContentResponse;
import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.TextPart;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executor;

/**
 * The ML Kit side of the system's own model (plan KI-Harness P2c): Gemini
 * Nano through the Prompt API. Loaded only on Android 8 and later — the
 * library needs it, the app runs from Android 7 — so the plugin creates it
 * after its version check and no class of ML Kit is touched before.
 */
final class PlatformModelRunner {

    /** The answers of the runner, in the plugin's terms. */
    interface Status {
        void available(String name, int window);
        void unavailable(String reason);
    }

    interface Answer {
        void text(String delta);
        void done();
        void cancelled();
        void failed(PlatformModelRules.Failure failure);
    }

    interface Download {
        void progress(String state, long bytes);
        void finished(PlatformModelRules.Failure failure);
    }

    private final GenerativeModelFutures model = GenerativeModelFutures.from(Generation.INSTANCE.getClient());
    private final Executor executor;

    PlatformModelRunner(Executor executor) {
        this.executor = executor;
    }

    static PlatformModelRules.Failure failureOf(Throwable error) {
        Throwable cause = error instanceof ExecutionException && error.getCause() != null ? error.getCause() : error;
        if (cause instanceof GenAiException) {
            GenAiException e = (GenAiException) cause;
            return PlatformModelRules.failure(e.getErrorCode(), e.getMessage());
        }
        return new PlatformModelRules.Failure("platform_error", PlatformModelRules.clip(String.valueOf(cause.getMessage())));
    }

    static boolean isCancel(Throwable error) {
        Throwable cause = error instanceof ExecutionException && error.getCause() != null ? error.getCause() : error;
        if (cause instanceof java.util.concurrent.CancellationException) return true;
        return cause instanceof GenAiException && PlatformModelRules.cancelled(((GenAiException) cause).getErrorCode());
    }

    void status(Status out) {
        ListenableFuture<Integer> status = model.checkStatus();
        status.addListener(() -> {
            int value;
            try {
                value = status.get();
            } catch (Exception e) {
                out.unavailable(reasonOf(e));
                return;
            }
            if (value != FeatureStatus.AVAILABLE) {
                out.unavailable(PlatformModelRules.reason(value == FeatureStatus.DOWNLOADABLE, value == FeatureStatus.DOWNLOADING));
                return;
            }
            ListenableFuture<Integer> limit = model.getTokenLimit();
            limit.addListener(() -> {
                int window;
                try {
                    window = limit.get();
                } catch (Exception e) {
                    window = PlatformModelRules.FALLBACK_WINDOW;
                }
                ListenableFuture<String> name = model.getBaseModelName();
                final int finalWindow = window;
                name.addListener(() -> {
                    String label;
                    try {
                        label = name.get();
                    } catch (Exception e) {
                        label = "Gemini Nano";
                    }
                    out.available(label == null || label.isEmpty() ? "Gemini Nano" : label, finalWindow);
                }, executor);
            }, executor);
        }, executor);
    }

    private static String reasonOf(Exception e) {
        PlatformModelRules.Failure failure = failureOf(e);
        return "platform_unavailable".equals(failure.code) ? failure.message : "notSupported";
    }

    ListenableFuture<GenerateContentResponse> generate(String instructions, String prompt, int answerTokens, Answer out) {
        GenerateContentRequest.Builder builder = new GenerateContentRequest.Builder(new TextPart(PlatformModelRules.prompt(instructions, prompt)));
        builder.setMaxOutputTokens(answerTokens);
        ListenableFuture<GenerateContentResponse> future = model.generateContent(builder.build(), new StreamingCallback() {
            @Override
            public void onNewText(String additionalText) {
                if (additionalText != null && !additionalText.isEmpty()) out.text(additionalText);
            }

            @Override
            public void onNewThought(String additionalThought) {
                // The model's own thoughts stay on the device; the answer is the text.
            }
        });
        future.addListener(() -> {
            if (future.isCancelled()) {
                out.cancelled();
                return;
            }
            try {
                future.get();
                out.done();
            } catch (Exception e) {
                if (isCancel(e)) out.cancelled();
                else out.failed(failureOf(e));
            }
        }, executor);
        return future;
    }

    void download(Download out) {
        ListenableFuture<Void> future = model.download(new DownloadCallback() {
            @Override
            public void onDownloadStarted(long bytesToDownload) {
                out.progress("started", bytesToDownload);
            }

            @Override
            public void onDownloadProgress(long totalBytesDownloaded) {
                out.progress("progress", totalBytesDownloaded);
            }

            @Override
            public void onDownloadCompleted() {
                out.progress("completed", 0);
            }

            @Override
            public void onDownloadFailed(GenAiException e) {
                out.progress("failed", 0);
            }
        });
        future.addListener(() -> {
            try {
                future.get();
                out.finished(null);
            } catch (Exception e) {
                out.finished(failureOf(e));
            }
        }, executor);
    }
}
