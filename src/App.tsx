import { useEffect, useMemo, useState } from "react";

type Response = {
  id: string;
  name: string;
  password?: string;
  dates: string[];
};

type EventState = {
  title: string;
  startDate: string;
  endDate: string;
  responses: Response[];
};

type CalendarSlot = {
  date: string | null;
};

const today = new Date();
const isoToday = toIsoDate(today);
const isoNextWeek = toIsoDate(addDays(today, 6));

const defaultDraft = {
  title: "",
  startDate: isoToday,
  endDate: isoNextWeek,
};

function App() {
  const [event, setEvent] = useState<EventState | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [draft, setDraft] = useState(defaultDraft);
  const [displayMonth, setDisplayMonth] = useState(monthKey(isoToday));
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [isPainting, setIsPainting] = useState(false);
  const [paintMode, setPaintMode] = useState<"add" | "remove">("add");
  const [dragAnchor, setDragAnchor] = useState<string | null>(null);
  const [dragBase, setDragBase] = useState<Set<string>>(new Set());
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);

  useEffect(() => {
    const stopPainting = () => {
      setIsPainting(false);
      setDragAnchor(null);
      setDragBase(new Set());
    };
    window.addEventListener("pointerup", stopPainting);
    return () => window.removeEventListener("pointerup", stopPainting);
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("event");
    if (!id) {
      setIsLoadingEvent(false);
      return;
    }

    let ignore = false;
    setIsLoadingEvent(true);
    fetchEvent(id)
      .then(({ event: loadedEvent }) => {
        if (ignore) return;
        setEventId(id);
        setEvent(loadedEvent);
        setDisplayMonth(monthKey(loadedEvent.startDate));
        setMessage("");
      })
      .catch(() => {
        if (ignore) return;
        setEventId(null);
        setEvent(null);
        setMessage("That event could not be found.");
      })
      .finally(() => {
        if (!ignore) {
          setIsLoadingEvent(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const dates = useMemo(() => (event ? getDateRange(event.startDate, event.endDate) : []), [event]);
  const availableDates = useMemo(() => new Set(dates), [dates]);
  const monthOptions = useMemo(() => (event ? getMonthOptions(event.startDate, event.endDate) : []), [event]);
  const calendarSlots = useMemo(() => getMonthCalendarSlots(displayMonth), [displayMonth]);
  const datePositions = useMemo(() => {
    const next = new Map<string, { row: number; col: number }>();
    calendarSlots.forEach((slot, index) => {
      if (slot.date) {
        next.set(slot.date, { row: Math.floor(index / 7), col: index % 7 });
      }
    });
    return next;
  }, [calendarSlots]);
  const counts = useMemo(() => {
    const next = new Map<string, number>();
    dates.forEach((date) => next.set(date, 0));
    event?.responses.forEach((response) => {
      response.dates.forEach((date) => next.set(date, (next.get(date) ?? 0) + 1));
    });
    return next;
  }, [dates, event]);
  const maxCount = Math.max(1, ...Array.from(counts.values()));
  const bestDates = dates.filter((date) => (counts.get(date) ?? 0) === maxCount && maxCount > 0);
  const hoveredResponses = useMemo(
    () => (hoveredDate && event ? event.responses.filter((response) => response.dates.includes(hoveredDate)) : []),
    [event, hoveredDate],
  );

  useEffect(() => {
    if (monthOptions.length > 0 && !monthOptions.includes(displayMonth)) {
      setDisplayMonth(monthOptions[0]);
    }
  }, [displayMonth, monthOptions]);

  useEffect(() => {
    setSelectedDates((current) => new Set(Array.from(current).filter((date) => availableDates.has(date))));
  }, [availableDates]);

  async function createEvent() {
    const title = draft.title.trim();
    if (!title || !draft.startDate || !draft.endDate) {
      setMessage("Add an event name and date range first.");
      return;
    }

    const nextEvent = {
      title,
      startDate: draft.startDate,
      endDate: draft.endDate,
      responses: [],
    };
    const created = await createRemoteEvent(nextEvent);
    setEventId(created.id);
    setEvent(created.event);
    setDisplayMonth(monthKey(draft.startDate));
    window.history.pushState(null, "", `?event=${created.id}`);
    setMessage("");
  }

  function applyDatesFromBase(base: Set<string>, dateList: string[], mode = paintMode) {
    const next = new Set(base);
    dateList.forEach((date) => {
      if (!availableDates.has(date)) {
        return;
      }
      if (mode === "add") {
        next.add(date);
      } else {
        next.delete(date);
      }
    });
    setSelectedDates(next);
  }

  function beginPaint(date: string) {
    const mode = selectedDates.has(date) ? "remove" : "add";
    const base = new Set(selectedDates);
    setPaintMode(mode);
    setIsPainting(true);
    setDragAnchor(date);
    setDragBase(base);
    applyDatesFromBase(base, [date], mode);
  }

  function extendPaint(date: string) {
    if (!isPainting || !dragAnchor) {
      return;
    }
    applyDatesFromBase(dragBase, getRectangleDates(dragAnchor, date, calendarSlots, datePositions), paintMode);
  }

  function extendPaintFromPoint(event: React.PointerEvent<HTMLElement>) {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>("[data-date]");
    const date = target?.dataset.date;
    if (date) {
      extendPaint(date);
    }
  }

  function loadResponse() {
    if (!event) return;
    const existing = findResponse(event.responses, name);
    if (!existing) {
      setMessage("No response found for that name.");
      return;
    }
    if (existing.password && existing.password !== password) {
      setMessage("That password does not match this response.");
      return;
    }
    setSelectedDates(new Set(existing.dates));
    setMessage(`Loaded ${existing.name}'s availability.`);
  }

  async function saveResponse() {
    if (!event) return;
    const trimmedName = name.trim();
    if (!trimmedName || selectedDates.size === 0) {
      return;
    }

    const existing = findResponse(event.responses, trimmedName);
    if (existing?.password && existing.password !== password) {
      setMessage("That password does not match this response.");
      return;
    }

    try {
      const saved = await saveRemoteResponse(eventId, trimmedName, password, Array.from(selectedDates).sort());
      setEvent(saved.event);
      setMessage("Availability saved.");
      setName("");
      setPassword("");
      setSelectedDates(new Set());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save availability.");
    }
  }

  async function removeResponse(response: Response) {
    if (!event) return;
    if (!canDeleteResponse(response, name, password)) {
      setMessage("Enter that response's name and password to delete it.");
      return;
    }
    try {
      const deleted = await deleteRemoteResponse(eventId, response.id, name, password);
      setEvent(deleted.event);
      setMessage(`${response.name}'s response was deleted.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete response.");
    }
  }

  function resetEvent() {
    setEvent(null);
    setEventId(null);
    setDraft(defaultDraft);
    setDisplayMonth(monthKey(isoToday));
    setName("");
    setPassword("");
    setSelectedDates(new Set());
    setMessage("");
    window.history.pushState(null, "", window.location.pathname);
  }

  if (isLoadingEvent) {
    return (
      <main className="create-shell">
        <section className="create-panel" aria-label="Loading event">
          <p className="kicker">When3Meet</p>
          <h1>Loading event.</h1>
        </section>
      </main>
    );
  }

  if (!event) {
    return (
      <main className="create-shell">
        <section className="create-panel" aria-label="Create event">
          <p className="kicker">When3Meet</p>
          <h1>Create an event.</h1>
          <label>
            Event name
            <input
              value={draft.title}
              onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))}
              placeholder="Dinner, trip, rehearsal..."
            />
          </label>
          <div className="date-fields">
            <label>
              First date
              <input
                type="date"
                value={draft.startDate}
                onChange={(e) => setDraft((current) => ({ ...current, startDate: e.target.value }))}
              />
            </label>
            <label>
              Last date
              <input
                type="date"
                value={draft.endDate}
                onChange={(e) => setDraft((current) => ({ ...current, endDate: e.target.value }))}
              />
            </label>
          </div>
          <button className="primary-button" type="button" onClick={createEvent}>
            Create Event
          </button>
          {message && <p className="form-message">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="event-editor" aria-label="Event setup">
        <div className="brand-row">
          <div>
            <p className="kicker">When3Meet</p>
            <h1>Find the best date.</h1>
          </div>
          <button className="ghost-button" type="button" onClick={resetEvent}>
            New Event
          </button>
        </div>

        <div className="response-form">
          {eventId && (
            <label>
              Event link
              <input readOnly value={window.location.href} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <button className="secondary-button" type="button" onClick={loadResponse} disabled={!name.trim()}>
            Load Existing
          </button>
          <button type="button" onClick={saveResponse} disabled={!name.trim() || selectedDates.size === 0}>
            Save Availability
          </button>
          {message && <p className="form-message">{message}</p>}
        </div>

        <div className="date-inspector" aria-live="polite">
          <div>
            <span>Selected date</span>
            <strong>{hoveredDate ? formatDate(hoveredDate) : "Hover a date"}</strong>
          </div>
          {hoveredDate ? (
            hoveredResponses.length > 0 ? (
              <ul>
                {hoveredResponses.map((response) => (
                  <li key={response.id}>{response.name}</li>
                ))}
              </ul>
            ) : (
              <p>No one has selected this date.</p>
            )
          ) : (
            <p>Names will appear here.</p>
          )}
        </div>
      </section>

      <section className="board-section" aria-label={`${event.title} availability`}>
        <div className="board-header">
          <div>
            <p className="kicker">Availability</p>
            <h2>{event.title || "Untitled event"}</h2>
          </div>
          <label className="month-selector">
            Month
            <select value={displayMonth} onChange={(e) => setDisplayMonth(e.target.value)}>
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {formatMonth(month)}
                </option>
              ))}
            </select>
          </label>
          <div className="best-date">
            <span>Best date</span>
            <strong>{bestDates.length ? formatDate(bestDates[0]) : "None yet"}</strong>
          </div>
        </div>

        <div className="calendar-board" onPointerMove={extendPaintFromPoint} onPointerLeave={() => setHoveredDate(null)}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="weekday-label">
              {day}
            </div>
          ))}
          {calendarSlots.map((slot, index) => {
            if (!slot.date) {
              return <div key={`blank-${index}`} className="calendar-blank" aria-hidden="true" />;
            }

            const date = slot.date;
            const count = counts.get(date) ?? 0;
            const isSelected = selectedDates.has(date);
            const isAvailable = availableDates.has(date);
            const heat = count / maxCount;
            return (
              <button
                key={date}
                className={`date-cell ${isSelected ? "selected" : ""} ${!isAvailable ? "outside-range" : ""}`}
                style={{ "--heat": heat } as React.CSSProperties}
                type="button"
                data-date={date}
                disabled={!isAvailable}
                onPointerDown={() => isAvailable && beginPaint(date)}
                onPointerEnter={() => {
                  setHoveredDate(date);
                  extendPaint(date);
                }}
                onFocus={() => setHoveredDate(date)}
                onPointerMove={extendPaintFromPoint}
                aria-pressed={isSelected}
              >
                <span>{monthName(date)}</span>
                <strong>{dayOfMonth(date)}</strong>
              </button>
            );
          })}
        </div>

        <div className="responses">
          <div className="responses-header">
            <h3>Responses</h3>
            <span>{event.responses.length}</span>
          </div>
          {event.responses.length === 0 ? (
            <p className="empty-state">No responses yet.</p>
          ) : (
            <div className="response-list">
              {event.responses.map((response) => (
                <article key={response.id} className="response-row">
                  <div>
                    <strong>{response.name}</strong>
                    <span>{response.dates.length} dates selected{response.password ? " · locked" : ""}</span>
                  </div>
                  {isSameName(response.name, name) && (
                    <button
                      type="button"
                      onClick={() => removeResponse(response)}
                      disabled={!canDeleteResponse(response, name, password)}
                      aria-label={`Remove ${response.name}`}
                    >
                      Remove
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function getDateRange(start: string, end: string) {
  if (!start || !end) return [];
  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  const [first, last] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
  const dates: string[] = [];
  for (let cursor = first; cursor <= last; cursor = addDays(cursor, 1)) {
    dates.push(toIsoDate(cursor));
  }
  return dates;
}

function getMonthCalendarSlots(month: string): CalendarSlot[] {
  const [year, monthIndex] = month.split("-").map(Number);
  const firstDate = new Date(year, monthIndex - 1, 1);
  const lastDate = new Date(year, monthIndex, 0);
  const firstDay = firstDate.getDay();
  const slots: CalendarSlot[] = Array.from({ length: firstDay }, () => ({ date: null }));
  for (let day = 1; day <= lastDate.getDate(); day += 1) {
    slots.push({ date: toIsoDate(new Date(year, monthIndex - 1, day)) });
  }
  while (slots.length % 7 !== 0) {
    slots.push({ date: null });
  }
  return slots;
}

function getMonthOptions(start: string, end: string) {
  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  const [first, last] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
  const months: string[] = [];
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
  const finalMonth = new Date(last.getFullYear(), last.getMonth(), 1);
  while (cursor <= finalMonth) {
    months.push(monthKey(toIsoDate(cursor)));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function getRectangleDates(
  start: string,
  end: string,
  slots: CalendarSlot[],
  positions: Map<string, { row: number; col: number }>,
) {
  const startPosition = positions.get(start);
  const endPosition = positions.get(end);
  if (!startPosition || !endPosition) return [end];

  const top = Math.min(startPosition.row, endPosition.row);
  const bottom = Math.max(startPosition.row, endPosition.row);
  const left = Math.min(startPosition.col, endPosition.col);
  const right = Math.max(startPosition.col, endPosition.col);

  return slots
    .filter((slot, index) => {
      const row = Math.floor(index / 7);
      const col = index % 7;
      return Boolean(slot.date) && row >= top && row <= bottom && col >= left && col <= right;
    })
    .map((slot) => slot.date!);
}

function findResponse(responses: Response[], name: string) {
  const normalized = name.trim().toLowerCase();
  return responses.find((response) => response.name.toLowerCase() === normalized);
}

function isSameName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function canDeleteResponse(response: Response, name: string, password: string) {
  return isSameName(response.name, name) && (!response.password || response.password === password);
}

async function fetchEvent(id: string) {
  const response = await fetch(`/api/events/${encodeURIComponent(id)}`);
  if (!response.ok) {
    throw new Error("Event not found");
  }
  return response.json() as Promise<{ id: string; event: EventState }>;
}

async function createRemoteEvent(event: EventState) {
  const response = await fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    throw new Error("Could not create event");
  }
  return response.json() as Promise<{ id: string; event: EventState }>;
}

async function saveRemoteResponse(id: string | null, name: string, password: string, dates: string[]) {
  if (!id) {
    throw new Error("Missing event id");
  }
  const response = await fetch(`/api/events/${encodeURIComponent(id)}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, password, dates }),
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error ?? "Could not save response");
  }
  return response.json() as Promise<{ id: string; event: EventState }>;
}

async function deleteRemoteResponse(id: string | null, responseId: string, name: string, password: string) {
  if (!id) {
    throw new Error("Missing event id");
  }
  const response = await fetch(`/api/events/${encodeURIComponent(id)}/responses/${encodeURIComponent(responseId)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error ?? "Could not delete response");
  }
  return response.json() as Promise<{ id: string; event: EventState }>;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(parseLocalDate(date));
}

function formatMonth(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(year, monthIndex - 1, 1));
}

function monthName(date: string) {
  return new Intl.DateTimeFormat("en", { month: "short" }).format(parseLocalDate(date));
}

function dayOfMonth(date: string) {
  return new Intl.DateTimeFormat("en", { day: "numeric" }).format(parseLocalDate(date));
}

export default App;
