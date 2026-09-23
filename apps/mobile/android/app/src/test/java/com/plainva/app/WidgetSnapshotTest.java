package com.plainva.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Calendar;
import java.util.Collections;
import java.util.List;

/**
 * What the widget makes of the file the app left it (plan Widgets, W3).
 *
 * The interesting part is not the parsing but the ARITHMETIC the widget does
 * on its own, because that is the part that has to keep being right while
 * Plainva is closed: which day it is, how much is overdue by now, and whether
 * what it is showing is old enough to say so.
 *
 * A plain JUnit test, so it runs without a device. `org.json` is on the
 * unit-test classpath for real (see app/build.gradle) — android.jar only stubs
 * it, and a parser test against stubs would pass on nothing.
 */
public class WidgetSnapshotTest {

    private static final String LABELS =
            "\"labels\":{\"today\":\"Heute\",\"overdue\":\"Überfällig\",\"empty\":\"Nichts fällig\","
                    + "\"locked\":\"Gesperrt\",\"pending\":\"wird übernommen\",\"newTask\":\"Aufgabe\",\"newJournal\":\"Journal\"}";

    private static String row(int index, String kind, String title, String day, String minutes, int priority) {
        return "{\"index\":" + index + ",\"kind\":\"" + kind + "\",\"title\":\"" + title + "\",\"day\":\"" + day
                + "\",\"minutes\":" + minutes + ",\"priority\":" + priority + "}";
    }

    private static String snapshot(long writtenAt, boolean locked, int overdue, String... rows) {
        StringBuilder out = new StringBuilder();
        out.append("{\"version\":1,\"writtenAt\":").append(writtenAt)
                .append(",\"vaultName\":\"Notizen\",\"locked\":").append(locked)
                .append(",\"overdue\":").append(overdue).append(",\"rows\":[");
        for (int i = 0; i < rows.length; i++) {
            if (i > 0) out.append(",");
            out.append(rows[i]);
        }
        return out.append("],").append(LABELS).append("}").toString();
    }

    private static long at(int year, int month, int day, int hour, int minute) {
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(year, month - 1, day, hour, minute);
        return c.getTimeInMillis();
    }

    @Test
    public void readsTheRowsOfOneDayInTheOrderTheAppSortedThem() {
        WidgetSnapshot s = WidgetSnapshot.parse(snapshot(at(2026, 9, 23, 8, 0), false, 0,
                row(0, "event", "Zahnarzt", "2026-09-23", "540", 0),
                row(1, "task", "Miete", "2026-09-23", "null", 2),
                row(2, "task", "Morgen", "2026-09-24", "null", 0)));
        assertNotNull(s);
        List<WidgetSnapshot.Row> rows = s.rowsOf("2026-09-23", Collections.<Integer>emptySet());
        assertEquals(2, rows.size());
        assertEquals("Zahnarzt", rows.get(0).title);
        assertFalse(rows.get(0).task);
        assertEquals(540, rows.get(0).minutes);
        assertEquals("Miete", rows.get(1).title);
        assertTrue(rows.get(1).task);
        assertEquals(-1, rows.get(1).minutes);
        assertEquals(2, rows.get(1).priority);
    }

    @Test
    public void countsWhatHasFallenIntoThePastSinceTheAppRan() {
        // The widget keeps working while Plainva does not, so "overdue" is the
        // count the app wrote PLUS the task rows that have since gone by.
        WidgetSnapshot s = WidgetSnapshot.parse(snapshot(at(2026, 9, 21, 18, 4), false, 2,
                row(0, "task", "Montag", "2026-09-21", "null", 0),
                row(1, "event", "Termin am Montag", "2026-09-21", "600", 0),
                row(2, "task", "Mittwoch", "2026-09-23", "null", 0)));
        assertNotNull(s);
        assertEquals(2, s.overdueOn("2026-09-21"));
        // Monday's task is overdue on Wednesday; Monday's appointment is not
        // overdue, it simply happened.
        assertEquals(3, s.overdueOn("2026-09-23"));
    }

    @Test
    public void saysHowOldItIsOnceItIsFromAnEarlierDay() {
        WidgetSnapshot s = WidgetSnapshot.parse(snapshot(at(2026, 9, 21, 18, 4), false, 0,
                row(0, "task", "Montag", "2026-09-21", "null", 0)));
        assertNotNull(s);
        assertFalse(s.staleOn("2026-09-21"));
        assertTrue(s.staleOn("2026-09-22"));
    }

    @Test
    public void marksTheRowsThatCarryATickTheAppHasNotRedeemed() {
        WidgetSnapshot s = WidgetSnapshot.parse(snapshot(at(2026, 9, 23, 8, 0), false, 0,
                row(0, "task", "Eine", "2026-09-23", "null", 0),
                row(1, "task", "Zwei", "2026-09-23", "null", 0)));
        assertNotNull(s);
        List<WidgetSnapshot.Row> rows = s.rowsOf("2026-09-23", Collections.singleton(Integer.valueOf(1)));
        assertFalse(rows.get(0).pending);
        assertTrue(rows.get(1).pending);
    }

    @Test
    public void aSealedVaultBringsNoRowsAtAll() {
        WidgetSnapshot s = WidgetSnapshot.parse(snapshot(at(2026, 9, 23, 8, 0), true, 0));
        assertNotNull(s);
        assertTrue(s.locked);
        assertTrue(s.rows.isEmpty());
        assertEquals("Gesperrt", s.labels.locked);
    }

    @Test
    public void refusesAFileItCannotVouchFor() {
        // Anything but a file this reader understands answers the same way,
        // and the widget then says "open Plainva" instead of inventing a day.
        assertNull(WidgetSnapshot.parse(null));
        assertNull(WidgetSnapshot.parse("nicht json"));
        assertNull(WidgetSnapshot.parse("{\"version\":2,\"rows\":[]}"));
        assertNull(WidgetSnapshot.parse("{\"version\":1}"));
    }

    @Test
    public void dropsARowWithoutAUsableDay() {
        WidgetSnapshot s = WidgetSnapshot.parse(snapshot(at(2026, 9, 23, 8, 0), false, 0,
                row(0, "task", "Gut", "2026-09-23", "null", 0),
                row(1, "task", "Kaputt", "23.09.", "null", 0)));
        assertNotNull(s);
        assertEquals(1, s.rows.size());
        assertEquals("Gut", s.rows.get(0).title);
    }

    @Test
    public void keepsPriorityInsideTheScale() {
        WidgetSnapshot s = WidgetSnapshot.parse(snapshot(at(2026, 9, 23, 8, 0), false, 0,
                row(0, "task", "Zu hoch", "2026-09-23", "null", 9),
                row(1, "task", "Zu tief", "2026-09-23", "null", -4)));
        assertNotNull(s);
        assertEquals(3, s.rows.get(0).priority);
        assertEquals(0, s.rows.get(1).priority);
    }

    @Test
    public void writesTheDayKeyTheWayTheAppDoes() {
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(2026, Calendar.JANUARY, 5);
        assertEquals("2026-01-05", WidgetSnapshot.dayOf(c));
    }
}
