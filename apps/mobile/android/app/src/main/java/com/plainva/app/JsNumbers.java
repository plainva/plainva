package com.plainva.app;

import com.getcapacitor.PluginCall;

/**
 * The one way the plugins read a whole number a call carries (release list
 * F55).
 *
 * The call's text is parsed by org.json, which makes a number an Integer when
 * it fits one, a Long when it does not and a Double when it has a point. The
 * typed getters of `PluginCall` answer anything but their own type with their
 * default: `getLong` lost every offset and size below 2 GB (a chunked upload
 * streamed every part from byte 0, a local model's files were refused), and
 * `getDouble` lost every time in milliseconds, which arrives as a Long (the
 * device calendar read an empty window, and deleting one occurrence of a
 * series deleted the whole series). This reader takes every kind of number;
 * `nativeNumberReads.test.ts` keeps the typed getters out of the plugins.
 */
final class JsNumbers {
    private JsNumbers() {}

    /** The whole number at `key`, whichever kind of number it arrived as; null when it is missing, not a number or not whole. */
    static Long whole(PluginCall call, String key) {
        Object value = call.getData().opt(key);
        if (!(value instanceof Number)) return null;
        Number number = (Number) value;
        if (value instanceof Double || value instanceof Float) {
            double d = number.doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d) || d != Math.rint(d)) return null;
        }
        return number.longValue();
    }

    /** `whole`, or `fallback` when the call carries no such key; null when it carries one that is not a whole number. */
    static Long whole(PluginCall call, String key, long fallback) {
        if (!call.getData().has(key) || call.getData().isNull(key)) return fallback;
        return whole(call, key);
    }

    /** For a setting with a default (a timeout, a batch number): the whole number at `key`, else `fallback`. */
    static long wholeOr(PluginCall call, String key, long fallback) {
        Long value = whole(call, key);
        return value == null ? fallback : value;
    }
}
