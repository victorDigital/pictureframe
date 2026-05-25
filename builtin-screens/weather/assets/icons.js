/** WMO weather code → icon key */
const ICON_KEY = {
  0: "clear",
  1: "mainly-clear",
  2: "partly-cloudy",
  3: "overcast",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  56: "freezing-drizzle",
  57: "freezing-drizzle",
  61: "rain",
  63: "rain",
  65: "heavy-rain",
  66: "freezing-rain",
  67: "freezing-rain",
  71: "snow",
  73: "snow",
  75: "heavy-snow",
  77: "snow-grains",
  80: "showers",
  81: "showers",
  82: "heavy-showers",
  85: "snow-showers",
  86: "heavy-snow-showers",
  95: "thunderstorm",
  96: "thunderstorm-hail",
  99: "thunderstorm-hail",
};

export const EMOJI = {
  0: "☀️",
  1: "🌤️",
  2: "⛅",
  3: "☁️",
  45: "🌫️",
  48: "🌫️",
  51: "🌦️",
  53: "🌦️",
  55: "🌦️",
  56: "🌧️",
  57: "🌧️",
  61: "🌧️",
  63: "🌧️",
  65: "🌧️",
  66: "🌧️",
  67: "🌧️",
  71: "🌨️",
  73: "🌨️",
  75: "❄️",
  77: "🌨️",
  80: "🌧️",
  81: "🌧️",
  82: "🌧️",
  85: "🌨️",
  86: "❄️",
  95: "⛈️",
  96: "⛈️",
  99: "⛈️",
};

export const SUMMARY = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Showers",
  81: "Heavy showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm",
};

function iconKey(code) {
  return ICON_KEY[code] ?? "unknown";
}

const LINE = {
  clear:
    '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
  "mainly-clear":
    '<circle cx="16" cy="8" r="3.5"/><path d="M16 3.5v1M16 12.5v1M12.8 5.2l.7.7M18.5 10.9l.7.7M11.5 8h1M19.5 8h1M12.8 10.8l.7-.7M18.5 5.1l.7-.7"/><path d="M7 18a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 18 18H7z"/>',
  "partly-cloudy":
    '<circle cx="17" cy="7.5" r="3"/><path d="M17 4v1M17 11v1M14.5 5.5l.7.7M19.5 9.5l.7.7M13.5 7.5h1M20.5 7.5h1"/><path d="M6 17a4 4 0 0 1 0-8 4.8 4.8 0 0 1 9.5 1A3.5 3.5 0 0 1 17 17H6z"/>',
  overcast: '<path d="M5 16a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 16H5z"/>',
  fog: '<path d="M4 10h16M4 14h16M6 18h12"/><path d="M5 16a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 16H5z" opacity="0.45"/>',
  drizzle:
    '<path d="M5 13a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 13H5z"/><path d="M8 17v2M12 17v2M16 17v2"/>',
  "freezing-drizzle":
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z"/><path d="M8 16l1 2M12 16l1 2M16 16l1 2"/>',
  rain:
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z"/><path d="M8 16l-1 3M12 16l-1 3M16 16l-1 3"/>',
  "heavy-rain":
    '<path d="M5 11a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 11H5z"/><path d="M7 15l-1.5 4M11 15l-1.5 4M15 15l-1.5 4M19 15l-1.5 4"/>',
  "freezing-rain":
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z"/><path d="M8 16l-1 3M12 16l-1 3M16 16l-1 3"/><path d="M8 20h.01M12 20h.01M16 20h.01"/>',
  snow:
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z"/><path d="M8 16v4M12 15v5M16 16v4M10 18h4"/>',
  "heavy-snow":
    '<path d="M5 11a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 11H5z"/><path d="M7 15v5M11 14v6M15 15v5M19 15v5M9 17h4M8 19h8"/>',
  "snow-grains":
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z"/><circle cx="8" cy="18" r="0.6"/><circle cx="12" cy="17" r="0.6"/><circle cx="16" cy="18" r="0.6"/>',
  showers:
    '<path d="M6 13a4 4 0 0 1 0-8 4.8 4.8 0 0 1 9.5 1A3.5 3.5 0 0 1 18 13H6z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
  "heavy-showers":
    '<path d="M6 12a4 4 0 0 1 0-8 4.8 4.8 0 0 1 9.5 1A3.5 3.5 0 0 1 18 12H6z"/><path d="M7 16l-1.5 4M11 16l-1.5 4M15 16l-1.5 4M19 16l-1.5 4"/>',
  "snow-showers":
    '<path d="M6 13a4 4 0 0 1 0-8 4.8 4.8 0 0 1 9.5 1A3.5 3.5 0 0 1 18 13H6z"/><path d="M8 17v4M12 16v5M16 17v4"/>',
  "heavy-snow-showers":
    '<path d="M6 12a4 4 0 0 1 0-8 4.8 4.8 0 0 1 9.5 1A3.5 3.5 0 0 1 18 12H6z"/><path d="M7 16v5M11 15v6M15 16v5M19 16v5"/>',
  thunderstorm:
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z"/><path d="M13 16h-2l2 4h-2l3 5"/>',
  "thunderstorm-hail":
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z"/><path d="M13 16h-2l2 4h-2l3 5"/><circle cx="8" cy="20" r="0.7"/><circle cx="12" cy="21" r="0.7"/><circle cx="16" cy="20" r="0.7"/>',
  unknown: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
};

const FILLED = {
  clear:
    '<circle cx="12" cy="12" r="5" fill="currentColor" opacity="0.95"/><g stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.85"><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2"/></g>',
  "mainly-clear":
    '<circle cx="16" cy="8" r="3.5" fill="currentColor"/><path d="M7 18a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 18 18H7z" fill="currentColor" opacity="0.75"/>',
  "partly-cloudy":
    '<circle cx="17" cy="7.5" r="3" fill="currentColor"/><path d="M6 17a4 4 0 0 1 0-8 4.8 4.8 0 0 1 9.5 1A3.5 3.5 0 0 1 17 17H6z" fill="currentColor" opacity="0.8"/>',
  overcast: '<path d="M5 16a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 16H5z" fill="currentColor"/>',
  fog: '<path d="M5 16a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 16H5z" fill="currentColor" opacity="0.35"/><rect x="4" y="10" width="16" height="2" rx="1" fill="currentColor" opacity="0.7"/><rect x="4" y="14" width="16" height="2" rx="1" fill="currentColor" opacity="0.55"/><rect x="6" y="18" width="12" height="2" rx="1" fill="currentColor" opacity="0.4"/>',
  drizzle:
    '<path d="M5 13a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 13H5z" fill="currentColor"/><rect x="7.5" y="16" width="1.5" height="3" rx="0.75" fill="currentColor" opacity="0.8"/><rect x="11.25" y="16" width="1.5" height="3" rx="0.75" fill="currentColor" opacity="0.8"/><rect x="15" y="16" width="1.5" height="3" rx="0.75" fill="currentColor" opacity="0.8"/>',
  "freezing-drizzle":
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z" fill="currentColor"/><path d="M8.5 16.5 9.5 19M12 16l1 3M15.5 16.5 16.5 19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  rain:
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z" fill="currentColor"/><path d="M8 16l-1 3M12 16l-1 3M16 16l-1 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  "heavy-rain":
    '<path d="M5 11a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 11H5z" fill="currentColor"/><path d="M7 15l-1.5 4M11 15l-1.5 4M15 15l-1.5 4M19 15l-1.5 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  "freezing-rain":
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z" fill="currentColor"/><path d="M8 16l-1 3M12 16l-1 3M16 16l-1 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="20.5" r="1" fill="currentColor"/><circle cx="12" cy="20.5" r="1" fill="currentColor"/><circle cx="16" cy="20.5" r="1" fill="currentColor"/>',
  snow:
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z" fill="currentColor"/><path d="M8 16v4M12 15v5M16 16v4M10 18h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  "heavy-snow":
    '<path d="M5 11a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 11H5z" fill="currentColor"/><path d="M7 15v5M11 14v6M15 15v5M19 15v5M9 17h4M8 19h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  "snow-grains":
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z" fill="currentColor"/><circle cx="8" cy="18" r="1" fill="currentColor"/><circle cx="12" cy="17" r="1" fill="currentColor"/><circle cx="16" cy="18" r="1" fill="currentColor"/>',
  showers:
    '<path d="M6 13a4 4 0 0 1 0-8 4.8 4.8 0 0 1 9.5 1A3.5 3.5 0 0 1 18 13H6z" fill="currentColor"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  "heavy-showers":
    '<path d="M6 12a4 4 0 0 1 0-8 4.8 4.8 0 0 1 9.5 1A3.5 3.5 0 0 1 18 12H6z" fill="currentColor"/><path d="M7 16l-1.5 4M11 16l-1.5 4M15 16l-1.5 4M19 16l-1.5 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  "snow-showers":
    '<path d="M6 13a4 4 0 0 1 0-8 4.8 4.8 0 0 1 9.5 1A3.5 3.5 0 0 1 18 13H6z" fill="currentColor"/><path d="M8 17v4M12 16v5M16 17v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  "heavy-snow-showers":
    '<path d="M6 12a4 4 0 0 1 0-8 4.8 4.8 0 0 1 9.5 1A3.5 3.5 0 0 1 18 12H6z" fill="currentColor"/><path d="M7 16v5M11 15v6M15 16v5M19 16v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  thunderstorm:
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z" fill="currentColor"/><path d="M13 16h-2l2 4h-2l3 5" fill="currentColor"/>',
  "thunderstorm-hail":
    '<path d="M5 12a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.8 1.2A4 4 0 0 1 19 12H5z" fill="currentColor"/><path d="M13 16h-2l2 4h-2l3 5" fill="currentColor"/><circle cx="8" cy="20.5" r="1" fill="currentColor"/><circle cx="12" cy="21" r="1" fill="currentColor"/><circle cx="16" cy="20.5" r="1" fill="currentColor"/>',
  unknown:
    '<circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.2"/><path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};

export function weatherIconSvg(code, style, className = "") {
  const key = iconKey(code);
  const inner = style === "filled" ? (FILLED[key] ?? FILLED.unknown) : (LINE[key] ?? LINE.unknown);
  const attrs =
    style === "filled"
      ? `viewBox="0 0 24 24" class="${className}" aria-hidden="true" focusable="false"`
      : `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true" focusable="false"`;
  return `<svg ${attrs}>${inner}</svg>`;
}

export function setWeatherIcon(el, code, style, svgClass = "") {
  if (style === "emoji") {
    el.textContent = EMOJI[code] ?? "?";
    return;
  }
  el.innerHTML = weatherIconSvg(code, style, svgClass);
}
