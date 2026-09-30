package com.plainva.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The model packages' rules, the same as the desktop's (plan KI-Harness P2a-3). */
public class LocalModelRulesTest {

    private static final String REV = "536a9f241cb3f02a9c5995a1e708c784bd274859";
    private static final String URL = "https://huggingface.co/onnx-community/m-ONNX/resolve/" + REV + "/onnx/model_quantized.onnx";

    @Test
    public void onlyAPinnedHubFileMayBeDownloaded() {
        assertTrue(LocalModelRules.allowedUrl(URL, "onnx/model_quantized.onnx"));
        assertFalse(LocalModelRules.allowedUrl(URL, "tokenizer.json"));
        assertFalse(LocalModelRules.allowedUrl(URL.replace(REV, "main"), "onnx/model_quantized.onnx"));
        assertFalse(LocalModelRules.allowedUrl(URL.replace("https://", "http://"), "onnx/model_quantized.onnx"));
        assertFalse(LocalModelRules.allowedUrl(URL.replace("huggingface.co", "example.com"), "onnx/model_quantized.onnx"));
        assertFalse(LocalModelRules.allowedUrl(URL + "?download=1", "onnx/model_quantized.onnx"));
    }

    @Test
    public void redirectsStayWithTheHubAndItsCdns() {
        assertTrue(LocalModelRules.allowedHost("huggingface.co"));
        assertTrue(LocalModelRules.allowedHost("us.aws.cdn.hf.co"));
        assertTrue(LocalModelRules.allowedHost("cdn-lfs.huggingface.co"));
        assertFalse(LocalModelRules.allowedHost("hf.co.example.com"));
        assertFalse(LocalModelRules.allowedHost("evilhuggingface.co"));
    }

    @Test
    public void namesCannotLeaveThePackageFolder() {
        assertTrue(LocalModelRules.validName("onnx/model_quantized.onnx"));
        assertFalse(LocalModelRules.validName("../secrets"));
        assertFalse(LocalModelRules.validName("onnx/../../x"));
        assertFalse(LocalModelRules.validName("/abs"));
        assertFalse(LocalModelRules.validName("a\\b"));
        assertTrue(LocalModelRules.validModel("qwen3-embedding-0.6b"));
        assertFalse(LocalModelRules.validModel("../x"));
        assertFalse(LocalModelRules.validModel("Granite"));
        assertTrue(LocalModelRules.validSha256("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
        assertFalse(LocalModelRules.validSha256("BA7816BF"));
    }

    // Two rows of three tokens, dim 2; the second row is padded after two tokens.
    private static final float[] HIDDEN = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 };
    private static final byte[] MASK = { 1, 1, 1, 1, 1, 0 };

    @Test
    public void poolingTakesTheFirstTheLastOrTheMean() {
        assertArrayEquals(new float[] { 1, 2, 7, 8 }, LocalModelRules.pool(HIDDEN, MASK, 2, 3, 2, LocalModelRules.POOL_CLS), 0f);
        assertArrayEquals(new float[] { 5, 6, 9, 10 }, LocalModelRules.pool(HIDDEN, MASK, 2, 3, 2, LocalModelRules.POOL_LAST), 0f);
        assertArrayEquals(new float[] { 3, 4, 8, 9 }, LocalModelRules.pool(HIDDEN, MASK, 2, 3, 2, LocalModelRules.POOL_MEAN), 0f);
    }

    @Test
    public void anEmptyCacheKeepsFixedSizesAndDropsThePast() {
        assertArrayEquals(new long[] { 3, 8, 0, 128 }, LocalModelRules.cacheShape(new long[] { -1, 8, -1, 128 }, 3));
    }
}
