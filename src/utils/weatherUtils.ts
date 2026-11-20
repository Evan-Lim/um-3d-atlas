import type {
  CampusWeatherReport,
  HeatLevel,
  RainLevel,
  WeatherForecastSlot,
} from '../types/map';

const UM_WEATHER_LAT = 3.1209;
const UM_WEATHER_LON = 101.6538;

export const OPEN_METEO_UM_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${UM_WEATHER_LAT}&longitude=${UM_WEATHER_LON}` +
  '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,weather_code,cloud_cover,wind_speed_10m' +
  '&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,uv_index,weather_code' +
  '&forecast_days=2&timezone=Asia%2FKuala_Lumpur';

export interface KlClock {
  hour24: number;
  minute: number;
  label: string;
}

/**
 * Returns the current local clock in Kuala Lumpur (Asia/Kuala_Lumpur, UTC+8).
 */
export function getKualaLumpurClock(now: Date = new Date()): KlClock {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const hourRaw = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
    const minuteRaw = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const hour24 = Number.isFinite(hourRaw) ? hourRaw % 24 : 12;
    const minute = Number.isFinite(minuteRaw) ? minuteRaw % 60 : 0;
    return {
      hour24,
      minute,
      label: `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')} MYT`,
    };
  } catch {
    const utcMs = now.getTime() + 8 * 3600 * 1000;
    const d = new Date(utcMs);
    const hour24 = d.getUTCHours();
    const minute = d.getUTCMinutes();
    return {
      hour24,
      minute,
      label: `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')} MYT`,
    };
  }
}

/**
 * Maps WMO weather interpretation code to a concise human-readable condition.
 */
export function describeWmoCode(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? 'Clear sky' : 'Clear night';
  if (code === 1) return isDay ? 'Mainly clear' : 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Hazy / misty';
  if (code >= 51 && code <= 57) return 'Light drizzle';
  if (code >= 61 && code <= 65) return code >= 65 ? 'Heavy rain' : 'Rain';
  if (code >= 80 && code <= 82) return code === 82 ? 'Heavy showers' : 'Rain showers';
  if (code >= 95) return 'Thunderstorm';
  return isDay ? 'Tropical humid' : 'Warm night';
}

export function isRainWmoCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

/**
 * Computes effective thermal stress (°C) combining apparent temperature with
 * Kuala Lumpur solar hour, UV load, cloud attenuation, and active rain cooling.
 */
export function computeEffectiveHeatIndexC(input: {
  apparentTempC: number;
  uvIndex: number;
  cloudCoverPct: number;
  hour24: number;
  precipitationMm: number;
}): number {
  let effective = input.apparentTempC;
  const isPeakSunWindow = input.hour24 >= 11 && input.hour24 <= 16;
  const isMidMorningOrLateAfternoon =
    (input.hour24 >= 9 && input.hour24 < 11) || (input.hour24 > 16 && input.hour24 <= 18);

  const sunExposure = Math.max(0, 1 - input.cloudCoverPct / 100);
  if (isPeakSunWindow && input.uvIndex >= 5) {
    effective += Math.min(2.2, (input.uvIndex / 10) * 2.0 * (0.45 + 0.55 * sunExposure));
  } else if (isMidMorningOrLateAfternoon && input.uvIndex >= 4) {
    effective += Math.min(1.0, (input.uvIndex / 10) * 0.9 * sunExposure);
  }

  if (input.precipitationMm >= 0.4) {
    effective -= 0.8;
  }

  return Number(effective.toFixed(1));
}

export function classifyHeatLevel(effectiveHeatC: number): {
  level: HeatLevel;
  label: string;
  advice: string;
} {
  if (effectiveHeatC < 27) {
    return {
      level: 'cool',
      label: 'Cool',
      advice: 'Comfortable outdoor walking and cycling',
    };
  }
  if (effectiveHeatC < 31) {
    return {
      level: 'warm',
      label: 'Warm',
      advice: 'Pleasant tropical warmth across campus',
    };
  }
  if (effectiveHeatC < 35) {
    return {
      level: 'hot',
      label: 'Hot',
      advice: 'Seek shade on exposed stretches and stay hydrated',
    };
  }
  if (effectiveHeatC < 38) {
    return {
      level: 'very-hot',
      label: 'Very Hot',
      advice: 'Prefer covered walkways and pace steep climbs',
    };
  }
  return {
    level: 'extreme',
    label: 'Extreme Heat',
    advice: 'Avoid prolonged sun; use covered paths or campus shuttle',
  };
}

/**
 * Predicts near-term precipitation probability (%) and tier by blending
 * live rainfall, hourly Open-Meteo probabilities over the next 2 hours,
 * atmospheric humidity/clouds, and KL's afternoon convective shower window (14:00–19:00 MYT).
 */
export function predictPrecipitation(input: {
  precipitationMm: number;
  weatherCode: number;
  hourlyPopWindow: number[];
  humidityPct: number;
  cloudCoverPct: number;
  hour24: number;
}): {
  chancePct: number;
  level: RainLevel;
  label: string;
  advice: string;
} {
  const validPops = input.hourlyPopWindow.filter((n) => Number.isFinite(n));
  const peakPop = validPops.length > 0 ? Math.max(...validPops) : 0;

  if (input.precipitationMm >= 0.2 || isRainWmoCode(input.weatherCode)) {
    const pct = Math.min(100, Math.max(85, Math.round(peakPop)));
    return {
      chancePct: pct,
      level: 'raining',
      label: 'Raining now',
      advice: 'Use covered walkways or UM shuttle',
    };
  }

  // Atmospheric convective indicator tailored to Kuala Lumpur's equatorial regime
  const isAfternoonConvective = input.hour24 >= 14 && input.hour24 <= 19;
  const humidityFactor = Math.max(0, (input.humidityPct - 62) / 38); // 0..1
  const cloudFactor = Math.max(0, input.cloudCoverPct / 100);
  const timeBias = isAfternoonConvective ? 24 : input.hour24 >= 12 && input.hour24 <= 21 ? 10 : 4;
  const localAtmosphericSignal = Math.min(
    90,
    humidityFactor * 36 + cloudFactor * 28 + timeBias,
  );

  const blended = validPops.length > 0
    ? peakPop * 0.78 + localAtmosphericSignal * 0.22
    : localAtmosphericSignal;
  const chancePct = Math.max(0, Math.min(98, Math.round(blended / 5) * 5));

  if (chancePct >= 65) {
    return {
      chancePct,
      level: 'likely',
      label: 'Likely rain',
      advice: 'Carry an umbrella · covered routes advised',
    };
  }
  if (chancePct >= 35) {
    return {
      chancePct,
      level: 'possible',
      label: 'Possible showers',
      advice: 'Keep an umbrella handy for sudden tropical showers',
    };
  }
  if (chancePct >= 15) {
    return {
      chancePct,
      level: 'low',
      label: 'Low rain chance',
      advice: 'Mostly dry with brief passing clouds',
    };
  }
  return {
    chancePct,
    level: 'dry',
    label: 'Dry',
    advice: 'Low precipitation risk',
  };
}

function buildRouteAdvisory(
  heat: { level: HeatLevel; label: string; advice: string },
  rain: { level: RainLevel; label: string; chancePct: number; advice: string },
  isDay: boolean,
  cloudCoverPct: number,
): string {
  const isSunny = isDay && cloudCoverPct < 75;
  if (rain.level === 'raining') {
    return 'Raining on campus — prefer covered walkways or UM shuttle';
  }
  if (rain.level === 'likely') {
    return `${rain.chancePct}% rain likely soon — bring an umbrella & use covered paths`;
  }
  if (heat.level === 'extreme' || heat.level === 'very-hot') {
    return rain.level === 'possible'
      ? `${heat.label} with ${rain.chancePct}% shower chance — use shaded walkways`
      : `${heat.label} outdoors — prefer covered walkways & pace steep hills`;
  }
  if (rain.level === 'possible') {
    return `${heat.label} · ${rain.chancePct}% shower chance — umbrella recommended`;
  }
  if (heat.level === 'hot') {
    return isSunny
      ? 'Hot sun on exposed paths — hydrate and take shaded shortcuts'
      : 'Hot & humid outdoors — stay hydrated and pace uphill stretches';
  }
  return `${heat.label} & dry — good conditions for walking or cycling`;
}

export interface RawOpenMeteoPayload {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    apparent_temperature?: number;
    is_day?: number;
    precipitation?: number;
    rain?: number;
    weather_code?: number;
    cloud_cover?: number;
    wind_speed_10m?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    apparent_temperature?: number[];
    relative_humidity_2m?: number[];
    precipitation_probability?: number[];
    precipitation?: number[];
    uv_index?: number[];
    weather_code?: number[];
  };
}

/**
 * Parses a live Open-Meteo JSON response into a time-aware CampusWeatherReport.
 */
export function parseOpenMeteoForecast(
  raw: RawOpenMeteoPayload,
  now: Date = new Date(),
): CampusWeatherReport | null {
  const cur = raw?.current;
  if (!cur || typeof cur.temperature_2m !== 'number') return null;

  const clock = getKualaLumpurClock(now);
  const tempC = Number(cur.temperature_2m.toFixed(1));
  const apparentC = Number((cur.apparent_temperature ?? cur.temperature_2m).toFixed(1));
  const humidityPct = Math.round(cur.relative_humidity_2m ?? 75);
  const cloudCoverPct = Math.round(cur.cloud_cover ?? 50);
  const windKmh = Math.round(cur.wind_speed_10m ?? 6);
  const precipitationMm = Number(Math.max(cur.precipitation ?? 0, cur.rain ?? 0).toFixed(1));
  const weatherCode = Number(cur.weather_code ?? 2);
  const isDay = cur.is_day !== undefined ? cur.is_day === 1 : clock.hour24 >= 7 && clock.hour24 < 19;

  // Locate current hour index in hourly arrays
  const hourly = raw.hourly;
  const times = hourly?.time ?? [];
  let currentHourIdx = 0;
  if (cur.time && times.length > 0) {
    const curHourPrefix = cur.time.slice(0, 13); // "YYYY-MM-DDTHH"
    const found = times.findIndex((t) => t.startsWith(curHourPrefix));
    if (found >= 0) currentHourIdx = found;
  }

  const uvNow = Number((hourly?.uv_index?.[currentHourIdx] ?? (isDay ? 5 : 0)).toFixed(1));
  const popWindow: number[] = [];
  for (let offset = 0; offset <= 2; offset += 1) {
    const pop = hourly?.precipitation_probability?.[currentHourIdx + offset];
    if (typeof pop === 'number' && Number.isFinite(pop)) popWindow.push(pop);
  }

  const effectiveHeatC = computeEffectiveHeatIndexC({
    apparentTempC: apparentC,
    uvIndex: uvNow,
    cloudCoverPct,
    hour24: clock.hour24,
    precipitationMm,
  });
  const heat = classifyHeatLevel(effectiveHeatC);
  const rain = predictPrecipitation({
    precipitationMm,
    weatherCode,
    hourlyPopWindow: popWindow,
    humidityPct,
    cloudCoverPct,
    hour24: clock.hour24,
  });

  // Next 4 hourly slots (current + next 3 hours)
  const hourlyOutlook: WeatherForecastSlot[] = [];
  for (let offset = 0; offset < 4; offset += 1) {
    const idx = currentHourIdx + offset;
    if (idx >= times.length) break;
    const iso = times[idx];
    const hh = Number(iso.slice(11, 13));
    const slotHour24 = Number.isFinite(hh) ? hh : (clock.hour24 + offset) % 24;
    const slotTemp = Number((hourly?.temperature_2m?.[idx] ?? tempC).toFixed(1));
    const slotFeels = Number((hourly?.apparent_temperature?.[idx] ?? slotTemp).toFixed(1));
    const slotUv = Number((hourly?.uv_index?.[idx] ?? 0).toFixed(1));
    const slotPop = Math.round(hourly?.precipitation_probability?.[idx] ?? rain.chancePct);
    const slotPrecip = Number((hourly?.precipitation?.[idx] ?? 0).toFixed(1));
    const slotCode = Number(hourly?.weather_code?.[idx] ?? weatherCode);
    const slotEffHeat = computeEffectiveHeatIndexC({
      apparentTempC: slotFeels,
      uvIndex: slotUv,
      cloudCoverPct,
      hour24: slotHour24,
      precipitationMm: slotPrecip,
    });
    const slotHeat = classifyHeatLevel(slotEffHeat);
    const slotRain = predictPrecipitation({
      precipitationMm: slotPrecip,
      weatherCode: slotCode,
      hourlyPopWindow: [slotPop],
      humidityPct,
      cloudCoverPct,
      hour24: slotHour24,
    });

    hourlyOutlook.push({
      hourLabel: offset === 0 ? 'Now' : `${String(slotHour24).padStart(2, '0')}:00`,
      hour24: slotHour24,
      tempC: slotTemp,
      feelsLikeC: slotFeels,
      rainChancePct: slotRain.chancePct,
      precipitationMm: slotPrecip,
      uvIndex: slotUv,
      heatLevel: slotHeat.level,
      heatLabel: slotHeat.label,
      rainLevel: slotRain.level,
    });
  }

  return {
    source: 'live',
    fetchedAt: now.getTime(),
    localTimeLabel: clock.label,
    localHour24: clock.hour24,
    isDay,
    conditionLabel: describeWmoCode(weatherCode, isDay),
    temperatureC: tempC,
    feelsLikeC: apparentC,
    humidityPct,
    cloudCoverPct,
    windKmh,
    uvIndex: uvNow,
    precipitationMm,
    heatLevel: heat.level,
    heatLabel: heat.label,
    heatAdvice: heat.advice,
    rainChancePct: rain.chancePct,
    rainLevel: rain.level,
    rainLabel: rain.label,
    rainAdvice: rain.advice,
    routeAdvisory: buildRouteAdvisory(heat, rain, isDay, cloudCoverPct),
    hourlyOutlook,
  };
}

/**
 * Kuala Lumpur equatorial diurnal weather estimate used automatically
 * before live weather arrives or when running offline.
 */
export function buildDiurnalFallbackWeather(now: Date = new Date()): CampusWeatherReport {
  const clock = getKualaLumpurClock(now);
  const h = clock.hour24;
  const isDay = h >= 7 && h < 19;

  // Typical Kuala Lumpur diurnal temperature, humidity, UV, and convective shower curves
  const sampleHour = (hour: number) => {
    const hh = ((hour % 24) + 24) % 24;
    // Peak temp around 14:00 (~33°C), cool dawn around 05:00 (~25°C)
    const temp = Number((28.8 + 4.0 * Math.sin(((hh - 8.5) / 24) * Math.PI * 2)).toFixed(1));
    const humidity = Math.round(78 - 14 * Math.sin(((hh - 8.5) / 24) * Math.PI * 2));
    const feelsLike = Number((temp + Math.max(1.2, (humidity - 55) * 0.11)).toFixed(1));
    const uv = hh >= 8 && hh <= 18 ? Number((Math.sin(((hh - 7) / 12) * Math.PI) * 10).toFixed(1)) : 0;
    const clouds = hh >= 14 && hh <= 19 ? 72 : hh >= 11 && hh < 14 ? 48 : 38;
    // Classic KL late-afternoon convective rain peak (14:00–18:00)
    const rainPop =
      hh >= 14 && hh <= 18 ? 55 : hh === 13 || hh === 19 ? 35 : hh >= 20 || hh <= 5 ? 20 : 15;
    return { hh, temp, humidity, feelsLike, uv, clouds, rainPop };
  };

  const cur = sampleHour(h);
  const effectiveHeat = computeEffectiveHeatIndexC({
    apparentTempC: cur.feelsLike,
    uvIndex: cur.uv,
    cloudCoverPct: cur.clouds,
    hour24: h,
    precipitationMm: 0,
  });
  const heat = classifyHeatLevel(effectiveHeat);
  const rain = predictPrecipitation({
    precipitationMm: 0,
    weatherCode: cur.clouds >= 65 ? 3 : 2,
    hourlyPopWindow: [cur.rainPop, sampleHour(h + 1).rainPop, sampleHour(h + 2).rainPop],
    humidityPct: cur.humidity,
    cloudCoverPct: cur.clouds,
    hour24: h,
  });

  const hourlyOutlook: WeatherForecastSlot[] = [0, 1, 2, 3].map((offset) => {
    const s = sampleHour(h + offset);
    const sEff = computeEffectiveHeatIndexC({
      apparentTempC: s.feelsLike,
      uvIndex: s.uv,
      cloudCoverPct: s.clouds,
      hour24: s.hh,
      precipitationMm: 0,
    });
    const sHeat = classifyHeatLevel(sEff);
    const sRain = predictPrecipitation({
      precipitationMm: 0,
      weatherCode: s.clouds >= 65 ? 3 : 2,
      hourlyPopWindow: [s.rainPop],
      humidityPct: s.humidity,
      cloudCoverPct: s.clouds,
      hour24: s.hh,
    });
    return {
      hourLabel: offset === 0 ? 'Now' : `${String(s.hh).padStart(2, '0')}:00`,
      hour24: s.hh,
      tempC: s.temp,
      feelsLikeC: s.feelsLike,
      rainChancePct: sRain.chancePct,
      precipitationMm: 0,
      uvIndex: s.uv,
      heatLevel: sHeat.level,
      heatLabel: sHeat.label,
      rainLevel: sRain.level,
    };
  });

  return {
    source: 'estimate',
    fetchedAt: now.getTime(),
    localTimeLabel: clock.label,
    localHour24: h,
    isDay,
    conditionLabel: h >= 14 && h <= 18 ? 'Afternoon clouds (KL est.)' : isDay ? 'Partly cloudy (KL est.)' : 'Humid evening (KL est.)',
    temperatureC: cur.temp,
    feelsLikeC: cur.feelsLike,
    humidityPct: cur.humidity,
    cloudCoverPct: cur.clouds,
    windKmh: 7,
    uvIndex: cur.uv,
    precipitationMm: 0,
    heatLevel: heat.level,
    heatLabel: heat.label,
    heatAdvice: heat.advice,
    rainChancePct: rain.chancePct,
    rainLevel: rain.level,
    rainLabel: rain.label,
    rainAdvice: rain.advice,
    routeAdvisory: buildRouteAdvisory(heat, rain, isDay, cur.clouds),
    hourlyOutlook,
  };
}

/**
 * Fetches live Universiti Malaya weather from Open-Meteo with resilient KL diurnal fallback.
 */
export async function fetchCampusWeather(signal?: AbortSignal): Promise<CampusWeatherReport> {
  try {
    const res = await fetch(OPEN_METEO_UM_URL, { signal });
    if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
    const json = (await res.json()) as RawOpenMeteoPayload;
    const parsed = parseOpenMeteoForecast(json, new Date());
    if (parsed) return parsed;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
  }
  return buildDiurnalFallbackWeather(new Date());
}
