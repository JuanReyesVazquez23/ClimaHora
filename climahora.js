"use strict";

/* ══════════════════════════════════════════
   CLIMAHORA — JS  v4
   + Base de datos ~40 ciudades República Dominicana
   + API key ofuscada + rate-limit local + caché en memoria
   + Lazy-load del mapa con IntersectionObserver
   + Autocomplete dual OWM + Nominatim con prioridad RD
   ══════════════════════════════════════════ */

// API key — protección real: restricción de dominio en panel.openweathermap.org
// (API Keys → Edit → API key restrictions → HTTP referrers → tu dominio de Netlify)
const WK = "2cdb197dabca650ec95c808f679bd9ef";

// ── Rate-limit local: máx 60 llamadas/hora a OWM ──
const RL_KEY   = "climahora-rl";
const RL_MAX   = 60;
const RL_WIN   = 3600_000; // 1 hora en ms

function puedeHacerLlamada() {
  try {
    const now  = Date.now();
    const data = JSON.parse(localStorage.getItem(RL_KEY) || '{"ts":0,"n":0}');
    if (now - data.ts > RL_WIN) { data.ts = now; data.n = 0; }
    if (data.n >= RL_MAX) return false;
    data.n++;
    localStorage.setItem(RL_KEY, JSON.stringify(data));
    return true;
  } catch { return true; }
}

// ── Caché en memoria para evitar llamadas repetidas ──
const cache = new Map();
function cacheGet(k)    { const e = cache.get(k); return e && Date.now()-e.ts < 300_000 ? e.v : null; }
function cacheSet(k, v) { cache.set(k, { v, ts: Date.now() }); if (cache.size > 40) cache.delete(cache.keys().next().value); }

// ── Selectores ──
const cityInput        = document.getElementById("cityInput");
const searchBtn        = document.getElementById("searchBtn");
const resultArea       = document.getElementById("result");
const historyArea      = document.getElementById("history");
const estadoEl         = document.getElementById("estado");
const autocompleteList = document.getElementById("autocompleteList");
const heroCity         = document.getElementById("heroCity");
const tplResult        = document.getElementById("tpl-result");
const tplHistory       = document.getElementById("tpl-history");

// ── Estado ──
let clockInterval = null;
let currentOffset = null;
let formato12h    = localStorage.getItem("climahora-fmt") !== "24";
let acTimeout     = null;
let acItems       = [];
let acIndex       = -1;
let idioma        = localStorage.getItem("climahora-lang") || "es";
let lastSearch    = null;
let lastClima     = null;
let unidadTemp    = localStorage.getItem("climahora-unit") || "C";
let modoOscuro    = localStorage.getItem("climahora-dark") === "1";
let mapObserver   = null;

let deferredInstallPrompt = null;

// ══════════════════════════════════════════
// BASE DE DATOS — CIUDADES REPÚBLICA DOMINICANA
// ~40 ciudades con coordenadas precisas
// Aparecen primero en autocomplete cuando la query es relevante
// ══════════════════════════════════════════
const CIUDADES_RD = [
  // Grandes ciudades / DN
  { name: "Distrito Nacional",  state: "Distrito Nacional",  country: "DO", lat: 18.4861,  lon: -69.9312 },
  { name: "Santo Domingo",      state: "Santo Domingo",      country: "DO", lat: 18.4861,  lon: -69.9312 },
  { name: "Santo Domingo Este", state: "Santo Domingo",      country: "DO", lat: 18.4897,  lon: -69.8706 },
  { name: "Santo Domingo Norte",state: "Santo Domingo",      country: "DO", lat: 18.5420,  lon: -69.9740 },
  { name: "Santo Domingo Oeste",state: "Santo Domingo",      country: "DO", lat: 18.4731,  lon: -70.0139 },
  { name: "Los Alcarrizos",     state: "Santo Domingo",      country: "DO", lat: 18.5000,  lon: -70.0514 },
  { name: "Pedro Brand",        state: "Santo Domingo",      country: "DO", lat: 18.5672,  lon: -70.0631 },
  { name: "Boca Chica",         state: "Santo Domingo",      country: "DO", lat: 18.4503,  lon: -69.6047 },
  { name: "San Antonio de Guerra", state: "Santo Domingo",   country: "DO", lat: 18.5303,  lon: -69.7425 },
  { name: "Guerra",             state: "Santo Domingo",      country: "DO", lat: 18.5456,  lon: -69.7297 },
  { name: "Villa Mella",        state: "Santo Domingo",      country: "DO", lat: 18.5614,  lon: -69.9539 },
  { name: "Los Tres Brazos",    state: "Santo Domingo",      country: "DO", lat: 18.5031,  lon: -69.8431 },
  // Norte / Cibao
  { name: "Santiago",           state: "Santiago",           country: "DO", lat: 19.4517,  lon: -70.6970 },
  { name: "Mao",                state: "Valverde",           country: "DO", lat: 19.5511,  lon: -71.0786 },
  { name: "La Vega",            state: "La Vega",            country: "DO", lat: 19.2228,  lon: -70.5292 },
  { name: "San Francisco de Macorís", state: "Duarte",       country: "DO", lat: 19.3007,  lon: -70.2527 },
  { name: "Moca",               state: "Espaillat",          country: "DO", lat: 19.3961,  lon: -70.5226 },
  { name: "Puerto Plata",       state: "Puerto Plata",       country: "DO", lat: 19.7936,  lon: -70.6878 },
  { name: "Sosúa",              state: "Puerto Plata",       country: "DO", lat: 19.7578,  lon: -70.5200 },
  { name: "Cabarete",           state: "Puerto Plata",       country: "DO", lat: 19.7633,  lon: -70.4167 },
  { name: "Imbert",             state: "Puerto Plata",       country: "DO", lat: 19.7558,  lon: -70.8317 },
  { name: "Luperón",            state: "Puerto Plata",       country: "DO", lat: 19.8928,  lon: -70.9589 },
  { name: "Altamira",           state: "Puerto Plata",       country: "DO", lat: 19.6694,  lon: -70.8414 },
  { name: "Valverde",           state: "Valverde",           country: "DO", lat: 19.5847,  lon: -70.9833 },
  { name: "Montecristi",        state: "Montecristi",        country: "DO", lat: 19.8564,  lon: -71.6497 },
  { name: "Guayubín",           state: "Montecristi",        country: "DO", lat: 19.6803,  lon: -71.4214 },
  { name: "Villa Vásquez",      state: "Montecristi",        country: "DO", lat: 19.7472,  lon: -71.4814 },
  { name: "Dajabón",            state: "Dajabón",            country: "DO", lat: 19.5481,  lon: -71.7086 },
  { name: "Partido",            state: "Dajabón",            country: "DO", lat: 19.6050,  lon: -71.6539 },
  { name: "Villa Bisono",       state: "Santiago",           country: "DO", lat: 19.5786,  lon: -70.8519 },
  { name: "Esperanza",          state: "Valverde",           country: "DO", lat: 19.5456,  lon: -70.9625 },
  { name: "Santiago Rodríguez", state: "Santiago Rodríguez", country: "DO", lat: 19.4878,  lon: -71.3400 },
  { name: "Sabaneta",           state: "Santiago Rodríguez", country: "DO", lat: 19.5267,  lon: -71.3492 },
  { name: "Las Matas de Santa Cruz", state: "Montecristi",   country: "DO", lat: 19.6628,  lon: -71.5136 },
  // Este
  { name: "San Pedro de Macorís", state: "San Pedro de Macorís", country: "DO", lat: 18.4558, lon: -69.3050 },
  { name: "La Romana",          state: "La Romana",          country: "DO", lat: 18.4273,  lon: -68.9724 },
  { name: "Higüey",             state: "La Altagracia",      country: "DO", lat: 18.6139,  lon: -68.7075 },
  { name: "Punta Cana",         state: "La Altagracia",      country: "DO", lat: 18.5820,  lon: -68.4053 },
  { name: "Bávaro",             state: "La Altagracia",      country: "DO", lat: 18.6825,  lon: -68.4532 },
  { name: "San Rafael del Yuma",state: "La Altagracia",      country: "DO", lat: 18.4333,  lon: -68.6833 },
  { name: "Veron",              state: "La Altagracia",      country: "DO", lat: 18.6336,  lon: -68.4714 },
  { name: "Hato Mayor",         state: "Hato Mayor",         country: "DO", lat: 18.7639,  lon: -69.2575 },
  { name: "El Seibo",           state: "El Seibo",           country: "DO", lat: 18.7656,  lon: -69.0386 },
  { name: "Miches",             state: "El Seibo",           country: "DO", lat: 18.9822,  lon: -69.0503 },
  { name: "Monte Plata",        state: "Monte Plata",        country: "DO", lat: 18.8061,  lon: -69.7844 },
  { name: "Bayaguana",          state: "Monte Plata",        country: "DO", lat: 18.7450,  lon: -69.6311 },
  { name: "Sabana Grande de Boyá", state: "Monte Plata",     country: "DO", lat: 18.9581,  lon: -69.8008 },
  { name: "Villa Hermosa",      state: "La Romana",          country: "DO", lat: 18.4167,  lon: -69.0167 },
  { name: "Consuelo",           state: "San Pedro de Macorís",country: "DO", lat: 18.6081, lon: -69.3678 },
  { name: "Quisqueya",          state: "San Pedro de Macorís",country: "DO", lat: 18.5500, lon: -69.4167 },
  { name: "Guaymate",           state: "La Romana",          country: "DO", lat: 18.5044,  lon: -69.1556 },
  // Sur
  { name: "San Cristóbal",      state: "San Cristóbal",      country: "DO", lat: 18.4167,  lon: -70.1167 },
  { name: "Villa Altagracia",   state: "San Cristóbal",      country: "DO", lat: 18.6644,  lon: -70.1736 },
  { name: "Cambita Garabitos",  state: "San Cristóbal",      country: "DO", lat: 18.4306,  lon: -70.2333 },
  { name: "Baní",               state: "Peravia",            country: "DO", lat: 18.2806,  lon: -70.3317 },
  { name: "Nizao",              state: "Peravia",             country: "DO", lat: 18.2358,  lon: -70.2178 },
  { name: "Azua",               state: "Azua",               country: "DO", lat: 18.4553,  lon: -70.7350 },
  { name: "Las Charcas",        state: "Azua",               country: "DO", lat: 18.2958,  lon: -70.6969 },
  { name: "Estebanía",          state: "Azua",               country: "DO", lat: 18.4167,  lon: -70.6333 },
  { name: "San Juan de la Maguana", state: "San Juan",       country: "DO", lat: 18.8067,  lon: -71.2289 },
  { name: "Las Matas de Farfán",state: "San Juan",           country: "DO", lat: 18.8769,  lon: -71.5278 },
  { name: "El Cercado",         state: "San Juan",           country: "DO", lat: 18.7244,  lon: -71.5225 },
  { name: "Barahona",           state: "Barahona",           country: "DO", lat: 18.2000,  lon: -71.1000 },
  { name: "Enriquillo",         state: "Barahona",           country: "DO", lat: 17.8989,  lon: -71.2378 },
  { name: "Cabral",             state: "Barahona",           country: "DO", lat: 18.2467,  lon: -71.2197 },
  { name: "Neiba",              state: "Baoruco",            country: "DO", lat: 18.4833,  lon: -71.4167 },
  { name: "Galván",             state: "Baoruco",            country: "DO", lat: 18.5328,  lon: -71.2847 },
  { name: "Tamayo",             state: "Baoruco",            country: "DO", lat: 18.4725,  lon: -71.2283 },
  { name: "Pedernales",         state: "Pedernales",         country: "DO", lat: 18.0383,  lon: -71.7447 },
  { name: "Oviedo",             state: "Pedernales",         country: "DO", lat: 17.8022,  lon: -71.4000 },
  { name: "Juancho",            state: "Pedernales",         country: "DO", lat: 17.8678,  lon: -71.5417 },
  { name: "Independencia",      state: "Independencia",      country: "DO", lat: 18.5167,  lon: -71.8500 },
  { name: "Jimaní",             state: "Independencia",      country: "DO", lat: 18.4933,  lon: -71.8508 },
  { name: "Comendador",         state: "Elías Piña",         country: "DO", lat: 18.8719,  lon: -71.7011 },
  { name: "Hondo Valle",        state: "Elías Piña",         country: "DO", lat: 18.7092,  lon: -71.7236 },
  { name: "Pedro Santana",      state: "Elías Piña",         country: "DO", lat: 18.9644,  lon: -71.7294 },
  // Centro / Valles
  { name: "Bonao",              state: "Monseñor Nouel",     country: "DO", lat: 18.9431,  lon: -70.4083 },
  { name: "Maimón",             state: "Monseñor Nouel",     country: "DO", lat: 18.9806,  lon: -70.3336 },
  { name: "Piedra Blanca",      state: "Monseñor Nouel",     country: "DO", lat: 18.9478,  lon: -70.5281 },
  { name: "Constanza",          state: "La Vega",            country: "DO", lat: 18.9108,  lon: -70.7456 },
  { name: "Jarabacoa",          state: "La Vega",            country: "DO", lat: 19.1181,  lon: -70.6378 },
  { name: "Jima Abajo",         state: "La Vega",            country: "DO", lat: 19.1414,  lon: -70.5383 },
  { name: "Cotui",              state: "Sánchez Ramírez",    country: "DO", lat: 19.0553,  lon: -70.1514 },
  { name: "Cevicos",            state: "Sánchez Ramírez",    country: "DO", lat: 18.9964,  lon: -69.9731 },
  { name: "Fantino",            state: "Sánchez Ramírez",    country: "DO", lat: 19.1178,  lon: -70.2022 },
  { name: "Nagua",              state: "María Trinidad Sánchez", country: "DO", lat: 19.3758, lon: -69.8475 },
  { name: "El Factor",          state: "María Trinidad Sánchez", country: "DO", lat: 19.3908, lon: -69.7497 },
  { name: "Cabrera",            state: "María Trinidad Sánchez", country: "DO", lat: 19.6369, lon: -69.9044 },
  { name: "Samaná",             state: "Samaná",             country: "DO", lat: 19.2053,  lon: -69.3369 },
  { name: "Las Terrenas",       state: "Samaná",             country: "DO", lat: 19.3103,  lon: -69.5411 },
  { name: "Sánchez",            state: "Samaná",             country: "DO", lat: 19.2281,  lon: -69.6100 },
  { name: "Las Galeras",        state: "Samaná",             country: "DO", lat: 19.2303,  lon: -69.2217 },
  // Cibao extra
  { name: "Licey al Medio",     state: "Santiago",           country: "DO", lat: 19.4025,  lon: -70.5978 },
  { name: "Tamboril",           state: "Santiago",           country: "DO", lat: 19.4878,  lon: -70.6136 },
  { name: "San José de las Matas", state: "Santiago",        country: "DO", lat: 19.3336,  lon: -70.9417 },
  { name: "Jánico",             state: "Santiago",           country: "DO", lat: 19.3194,  lon: -70.8278 },
  { name: "Villa González",     state: "Santiago",           country: "DO", lat: 19.5244,  lon: -70.7489 },
  { name: "San Víctor",         state: "Espaillat",          country: "DO", lat: 19.3750,  lon: -70.5667 },
  { name: "Jamao al Norte",     state: "Espaillat",          country: "DO", lat: 19.4592,  lon: -70.4575 },
  { name: "Gaspar Hernández",   state: "Espaillat",          country: "DO", lat: 19.6233,  lon: -70.2842 },
  { name: "Castillo",           state: "Duarte",             country: "DO", lat: 19.2058,  lon: -70.0178 },
  { name: "Villa Riva",         state: "Duarte",             country: "DO", lat: 19.1786,  lon: -69.9036 },
  { name: "Arenoso",            state: "Duarte",             country: "DO", lat: 19.1669,  lon: -69.8358 },
  { name: "Pimentel",           state: "Duarte",             country: "DO", lat: 19.1911,  lon: -70.1061 },
];

// Términos que indican intención de buscar en RD
const TERMINOS_RD = [
  "republica dominicana","república dominicana","republica","dominican",
  "dominicana","dominicano","r.d.","rd","santo domingo","distrito nacional",
  "santiago","la vega","bavaro","punta cana","samana","barahona",
  "bonao","jarabacoa","constanza","nagua","sosua","cabarete"
];

function esQueryRD(query) {
  const q = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return TERMINOS_RD.some(t => q.includes(t.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
}

// Filtra ciudades RD que coincidan con la query
function buscarCiudadesRD(query) {
  const q = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(",")[0].trim();
  if (q.length < 2) return [];
  return CIUDADES_RD.filter(c => {
    const nombre = c.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return nombre.includes(q) || q.includes(nombre.split(" ")[0]);
  }).slice(0, 6);
}

// ══════════════════════════════════════════
// IDIOMAS
// ══════════════════════════════════════════
const IDIOMAS = [
  { code: "es", owm: "es",    flag: "🇪🇸", label: "ES" },
  { code: "en", owm: "en",    flag: "🇺🇸", label: "EN" },
  { code: "fr", owm: "fr",    flag: "🇫🇷", label: "FR" },
  { code: "pt", owm: "pt",    flag: "🇧🇷", label: "PT" },
  { code: "zh", owm: "zh_cn", flag: "🇨🇳", label: "ZH" },
];
const LOCALE_MAP = { es:"es-ES", en:"en-US", fr:"fr-FR", pt:"pt-BR", zh:"zh-CN" };

const T = {
  brandSub:    { es:"Hora & Clima Mundial",  en:"World Time & Weather",   fr:"Heure & Météo Mondiale", pt:"Hora & Clima Mundial", zh:"世界时间与天气" },
  heroText:    { es:"Así está el clima en",  en:"Current weather in",     fr:"La météo actuelle à",    pt:"O clima agora em",     zh:"当前天气"       },
  heroDefault: { es:". . .",                 en:". . .",                   fr:". . .",                  pt:". . .",                zh:". . ."          },
  placeholder: { es:"Ciudad, País…",         en:"City, Country…",         fr:"Ville, Pays…",           pt:"Cidade, País…",        zh:"城市, 国家…"    },
  searching:   { es:"Buscando…",             en:"Searching…",             fr:"Recherche…",             pt:"Buscando…",            zh:"搜索中…"        },
  loading:     { es:"Obteniendo datos…",     en:"Loading data…",          fr:"Chargement…",            pt:"Carregando dados…",    zh:"加载数据…"      },
  errNotFound: {
    es:'❌ Ciudad no encontrada. Prueba: "Santo Domingo, DO"',
    en:'❌ City not found. Try: "Santo Domingo, DO"',
    fr:'❌ Ville introuvable. Essayez: "Paris, FR"',
    pt:'❌ Cidade não encontrada. Tente: "São Paulo, BR"',
    zh:'❌ 未找到城市，请尝试："北京, CN"'
  },
  errLimit:    { es:"⏳ Límite de búsquedas alcanzado. Espera un momento.", en:"⏳ Search limit reached. Please wait.", fr:"⏳ Limite atteinte.", pt:"⏳ Limite atingido.", zh:"⏳ 搜索限制已达到。" },
  errCoords:   { es:"❌ No se pudo obtener la información.", en:"❌ Could not get the information.", fr:"❌ Impossible d'obtenir les informations.", pt:"❌ Não foi possível.", zh:"❌ 无法获取信息。" },
  feelsLike:   { es:"Sensación",   en:"Feels like",  fr:"Ressenti",            pt:"Sensação",     zh:"体感"       },
  clockLabel:  { es:"Hora local",  en:"Local time",  fr:"Heure locale",        pt:"Hora local",   zh:"当地时间"   },
  mapLabel:    { es:"Ubicación",   en:"Location",    fr:"Emplacement",         pt:"Localização",  zh:"位置"       },
  mapLink:     { es:"Ver en OpenStreetMap", en:"View on OpenStreetMap", fr:"Voir sur OpenStreetMap", pt:"Ver no OpenStreetMap", zh:"在地图上查看" },
  histTitle:   { es:"Recientes",   en:"Recent",      fr:"Récents",             pt:"Recentes",     zh:"最近"       },
  clearHist:   { es:"Limpiar",     en:"Clear",       fr:"Effacer",             pt:"Limpar",       zh:"清除"       },
  tagline:     { es:"— Accesible, cómoda y siempre al día —", en:"— Accessible, comfortable and always up to date —", fr:"— Accessible, agréable et toujours à jour —", pt:"— Acessível, cómoda e sempre atualizada —", zh:"— 便捷、舒适，始终保持最新 —" },
  humidity:    { es:"Humedad",     en:"Humidity",    fr:"Humidité",            pt:"Umidade",      zh:"湿度"       },
  wind:        { es:"Viento",      en:"Wind",        fr:"Vent",                pt:"Vento",        zh:"风速"       },
  minMax:      { es:"Mín / Máx",   en:"Min / Max",   fr:"Min / Max",           pt:"Mín / Máx",   zh:"最低/最高"  },
  clouds:      { es:"Nubosidad",   en:"Clouds",      fr:"Nébulosité",          pt:"Nuvens",       zh:"云量"       },
  sunrise:     { es:"Amanecer",    en:"Sunrise",     fr:"Lever du soleil",     pt:"Nascer do sol",zh:"日出"       },
  sunset:      { es:"Atardecer",   en:"Sunset",      fr:"Coucher du soleil",   pt:"Pôr do sol",  zh:"日落"       },
  installApp:  { es:"Instalar app",en:"Install app", fr:"Installer l'app",     pt:"Instalar app", zh:"安装应用"   },
  darkMode:    { es:"Modo oscuro", en:"Dark mode",   fr:"Mode sombre",         pt:"Modo escuro",  zh:"深色模式"   },
  lightMode:   { es:"Modo claro",  en:"Light mode",  fr:"Mode clair",          pt:"Modo claro",   zh:"浅色模式"   },
  rdBadge:     { es:"🇩🇴 RD",       en:"🇩🇴 RD",       fr:"🇩🇴 RD",              pt:"🇩🇴 RD",        zh:"🇩🇴 RD"     },
};

function t(key) { return T[key]?.[idioma] ?? T[key]?.es ?? key; }
function getLangConfig() { return IDIOMAS.find(l => l.code === idioma) || IDIOMAS[0]; }

// ══════════════════════════════════════════
// MODO OSCURO
// ══════════════════════════════════════════
function aplicarModoOscuro(oscuro) {
  document.documentElement.classList.toggle("dark", oscuro);
  const btn = document.getElementById("darkToggleBtn");
  if (!btn) return;
  btn.innerHTML = oscuro
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/>
      </svg>`;
  btn.setAttribute("aria-label", oscuro ? t("lightMode") : t("darkMode"));
}

function toggleModoOscuro() {
  modoOscuro = !modoOscuro;
  localStorage.setItem("climahora-dark", modoOscuro ? "1" : "0");
  aplicarModoOscuro(modoOscuro);
}

// ══════════════════════════════════════════
// PWA — BOTÓN INSTALAR
// ══════════════════════════════════════════
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstallPrompt = e; mostrarBotonInstalar(); });
window.addEventListener("appinstalled", () => { ocultarBotonInstalar(); deferredInstallPrompt = null; });

function mostrarBotonInstalar() {
  if (document.getElementById("pwa-install-btn")) return;
  const btn = document.createElement("button");
  btn.id = "pwa-install-btn";
  btn.className = "pwa-install-btn";
  btn.setAttribute("aria-label", t("installApp"));
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 3v12M7 11l5 5 5-5"/><path d="M3 19h18"/></svg><span class="pwa-install-label">${t("installApp")}</span>`;
  btn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    btn.classList.add("pwa-install-btn--loading");
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    btn.classList.remove("pwa-install-btn--loading");
    if (outcome === "accepted") { ocultarBotonInstalar(); deferredInstallPrompt = null; }
  });
  document.body.appendChild(btn);
  requestAnimationFrame(() => requestAnimationFrame(() => btn.classList.add("pwa-install-btn--visible")));
}
function ocultarBotonInstalar() {
  const btn = document.getElementById("pwa-install-btn");
  if (btn) { btn.classList.remove("pwa-install-btn--visible"); setTimeout(() => btn.remove(), 400); }
}

// ══════════════════════════════════════════
// TEMPERATURA
// ══════════════════════════════════════════
function cToF(c) { return Math.round(c * 9 / 5 + 32); }
function fmtTemp(c) { return unidadTemp === "F" ? cToF(c) : Math.round(c); }

function actualizarUnidadTemp() {
  if (!lastClima) return;
  const c = lastClima;
  const unit = unidadTemp === "F" ? "°F" : "°C";
  const q = sel => resultArea.querySelector(sel);
  if (q("#tempValue"))    q("#tempValue").textContent   = fmtTemp(c.temp);
  if (q("#tempUnitLabel"))q("#tempUnitLabel").textContent = unit;
  if (q("#tempUnitToggle"))q("#tempUnitToggle").textContent = unidadTemp==="F"?"°C":"°F";
  if (q("#tempFeels") && q("#tempFeels").dataset.feelsVal)
    q("#tempFeels").textContent = `${t("feelsLike")} ${fmtTemp(+q("#tempFeels").dataset.feelsVal)}${unit}`;
  if (q("#statMinMaxValue"))
    q("#statMinMaxValue").textContent = `${fmtTemp(c.tempMin)}° / ${fmtTemp(c.tempMax)}°`;
}

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
(function init() {
  aplicarModoOscuro(modoOscuro);
  renderHistorial();
  autodetectar();
  aplicarIdioma();

  document.getElementById("darkToggleBtn")?.addEventListener("click", toggleModoOscuro);

  document.addEventListener("click", e => {
    if (!e.target.closest(".lang-selector")) cerrarLangMenu();
    if (!e.target.closest(".search-group"))  cerrarAc();
  });

  searchBtn.addEventListener("click", iniciarBusqueda);

  cityInput.addEventListener("keydown", e => {
    if (e.key === "Enter")     { acIndex >= 0 && acItems[acIndex] ? seleccionarSugerencia(acItems[acIndex]) : iniciarBusqueda(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); moverAc(1);  return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); moverAc(-1); return; }
    if (e.key === "Escape")    { cerrarAc(); }
  });

  cityInput.addEventListener("input", () => {
    clearTimeout(acTimeout);
    const val = cityInput.value.trim();
    if (val.length < 2) { cerrarAc(); return; }
    acTimeout = setTimeout(() => buscarSugerencias(val), 260);
  });
})();

// ══════════════════════════════════════════
// IDIOMAS
// ══════════════════════════════════════════
function cerrarLangMenu() { document.getElementById("langMenu")?.classList.remove("open"); }
function toggleLangMenu()  { document.getElementById("langMenu")?.classList.toggle("open"); }

function seleccionarIdioma(code) {
  idioma = code;
  localStorage.setItem("climahora-lang", idioma);
  cerrarLangMenu();
  aplicarIdioma();
  if (lastSearch) actualizarDescripcionIdioma();
  aplicarModoOscuro(modoOscuro);
}

async function actualizarDescripcionIdioma() {
  if (!lastSearch) return;
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lastSearch.lat}&lon=${lastSearch.lon}&appid=${WK}&units=metric&lang=${getLangConfig().owm}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const el = resultArea.querySelector("#weatherDesc");
    if (el) el.textContent = data.weather[0].description;
    if (lastClima) lastClima.desc = data.weather[0].description;
  } catch { /* silencioso */ }
}

function aplicarIdioma() {
  const lang = getLangConfig();
  const langBtn = document.getElementById("langBtn");
  if (langBtn) {
    langBtn.querySelector(".lang-flag").textContent  = lang.flag;
    langBtn.querySelector(".lang-label").textContent = lang.label;
  }
  document.querySelectorAll(".lang-option").forEach(el =>
    el.classList.toggle("lang-option--active", el.dataset.code === idioma));

  const se = (id, key) => { const el = document.getElementById(id); if (el) el.textContent = t(key); };
  se("brandSub", "brandSub");
  const heroP = document.querySelector(".hero-text");
  if (heroP?.childNodes[0]) heroP.childNodes[0].textContent = t("heroText") + "\n";
  const heroCityEl = document.getElementById("heroCity");
  if (heroCityEl && heroCityEl.dataset.defaultText !== "false") heroCityEl.textContent = t("heroDefault");
  cityInput.placeholder = t("placeholder");

  const q = s => resultArea.querySelector(s);
  if (q("#clockLabel"))   q("#clockLabel").textContent   = t("clockLabel");
  if (q("#mapLabel"))     q("#mapLabel").textContent     = t("mapLabel");
  if (q("#mapLinkText"))  q("#mapLinkText").textContent  = t("mapLink");
  if (q("#tempFeels") && q("#tempFeels").dataset.feelsVal) {
    const fVal = +q("#tempFeels").dataset.feelsVal;
    q("#tempFeels").textContent = `${t("feelsLike")} ${fmtTemp(fVal)}${unidadTemp==="F"?"°F":"°C"}`;
  }
  [ ["#statHumidityLabel","humidity"],["#statWindLabel","wind"],
    ["#statMinMaxLabel","minMax"],    ["#statCloudsLabel","clouds"],
    ["#sunriseLabel","sunrise"],      ["#sunsetLabel","sunset"] ]
  .forEach(([s, k]) => { const el = q(s); if (el) el.textContent = t(k); });
  if (lastClima) {
    const windEl = q("#statWindValue");
    if (windEl) windEl.textContent = `${lastClima.windSpeed} km/h${windDir(lastClima.windDeg) ? " "+windDir(lastClima.windDeg) : ""}`;
  }
  historyArea.querySelector("#historyTitle") && (historyArea.querySelector("#historyTitle").textContent = t("histTitle"));
  historyArea.querySelector("#clearHistory") && (historyArea.querySelector("#clearHistory").textContent = t("clearHist"));
  const taglineEl = document.getElementById("tagline");
  if (taglineEl) taglineEl.textContent = t("tagline");
  document.documentElement.lang = lang.code;
}

// ══════════════════════════════════════════
// AUTOCOMPLETE — TRIPLE: RD local + OWM + Nominatim
// ══════════════════════════════════════════
async function buscarSugerencias(query) {
  // 1. Resultados locales RD (instantáneos, sin red)
  const rdLocal = buscarCiudadesRD(query);

  // 2. Si ya tenemos suficientes resultados RD y la query es claramente de RD, mostramos inmediato
  if (rdLocal.length >= 4 && esQueryRD(query)) {
    acItems = rdLocal;
    renderAc(rdLocal);
  }

  // 3. Consultas en paralelo (con caché)
  try {
    const [owmRes, nomRes] = await Promise.allSettled([
      buscarOWM(query),
      buscarNominatim(query),
    ]);
    const owm = owmRes.status === "fulfilled" ? owmRes.value : [];
    const nom = nomRes.status === "fulfilled" ? nomRes.value : [];

    // Fusionar: RD local primero, luego OWM, luego Nominatim
    const merged = fusionarSugerencias(rdLocal, owm, nom);
    acItems = merged;
    renderAc(merged);
  } catch { /* ya mostramos resultados locales */ }
}

function parsearQueryCiudad(query) {
  const partes = query.split(",").map(s => s.trim());
  if (partes.length >= 2) {
    const ciudad = partes[0];
    const pais   = partes[partes.length - 1];
    if (/^[A-Za-z]{2}$/.test(pais)) return { ciudad, codigoPais: pais.toUpperCase() };
    const codigo = nombrePaisACodigo(pais);
    if (codigo) return { ciudad, codigoPais: codigo };
    return { ciudad: query, codigoPais: null };
  }
  return { ciudad: query, codigoPais: null };
}

async function buscarOWM(query) {
  const cacheKey = "owm:" + query;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const { ciudad, codigoPais } = parsearQueryCiudad(query);
  const q   = codigoPais ? `${ciudad},${codigoPais}` : ciudad;
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=10&appid=${WK}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const result = data.map(item => ({ name: item.name, state: item.state||"", country: item.country||"", lat: item.lat, lon: item.lon }));
  cacheSet(cacheKey, result);
  return result;
}

async function buscarNominatim(query) {
  const cacheKey = "nom:" + query;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&featuretype=city&addressdetails=1`;
  const res  = await fetch(url, { headers: { "Accept-Language": idioma, "User-Agent": "ClimaHora/4.0" } });
  if (!res.ok) return [];
  const data = await res.json();
  const result = data
    .filter(i => ["city","town","village"].includes(i.type) || i.class === "place")
    .map(i => ({
      name:    i.address?.city || i.address?.town || i.address?.village || i.display_name.split(",")[0].trim(),
      state:   i.address?.state || i.address?.county || "",
      country: (i.address?.country_code || "").toUpperCase(),
      lat:     parseFloat(i.lat),
      lon:     parseFloat(i.lon),
    }));
  cacheSet(cacheKey, result);
  return result;
}

// Fusiona RD local + OWM + Nominatim sin duplicados (< 0.25° de distancia)
function fusionarSugerencias(rdLocal, owm, nominatim) {
  const combined = [...rdLocal];

  const agregar = (item) => {
    const dup = combined.some(ex => Math.abs(ex.lat - item.lat) < 0.25 && Math.abs(ex.lon - item.lon) < 0.25);
    if (!dup && combined.length < 10) combined.push(item);
  };

  owm.forEach(agregar);
  nominatim.forEach(agregar);
  return combined;
}

// ── Renderiza dropdown con badge RD especial ──
function renderAc(items) {
  autocompleteList.innerHTML = "";
  acIndex = -1;
  if (!items?.length) { cerrarAc(); return; }

  items.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "autocomplete-item";
    li.style.animationDelay = `${i * 25}ms`;

    const paisNombre = nombrePais(item.country);
    const bandera    = item.country ? countryToFlag(item.country) : "";
    const esRD       = item.country === "DO";

    const linea1 = item.state
      ? `${escHtml(item.name)}<span class="ac-state">, ${escHtml(item.state)}</span>`
      : escHtml(item.name);

    li.innerHTML = `
      <svg class="ac-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
        <circle cx="12" cy="9" r="2.5"/>
      </svg>
      <div class="ac-text">
        <span class="ac-city">${linea1}</span>
        <span class="ac-country-full">${bandera} ${escHtml(paisNombre)}</span>
      </div>
      ${esRD ? '<span class="ac-rd-badge">🇩🇴 RD</span>' : ""}
    `;
    const select = (e) => { e.preventDefault(); seleccionarSugerencia(item); };
    li.addEventListener("mousedown", select);
    li.addEventListener("touchend",  select);
    autocompleteList.appendChild(li);
  });

  autocompleteList.classList.add("open");
}

function seleccionarSugerencia(item) {
  cityInput.value = item.country ? `${item.name}, ${nombrePais(item.country)}` : item.name;
  cerrarAc();
  buscarPorCoords(item.lat, item.lon, item.name);
}

function moverAc(dir) {
  const items = autocompleteList.querySelectorAll(".autocomplete-item");
  if (!items.length) return;
  items[acIndex]?.classList.remove("ac-active");
  acIndex = Math.max(-1, Math.min(items.length - 1, acIndex + dir));
  items[acIndex]?.classList.add("ac-active");
  if (acIndex >= 0) {
    const item = acItems[acIndex];
    cityInput.value = item.country ? `${item.name}, ${nombrePais(item.country)}` : item.name;
  }
}

function cerrarAc() { autocompleteList.classList.remove("open"); autocompleteList.innerHTML = ""; acItems = []; acIndex = -1; }

// ══════════════════════════════════════════
// BÚSQUEDA
// ══════════════════════════════════════════
async function iniciarBusqueda() {
  const raw = cityInput.value.trim();
  if (!raw) { cityInput.focus(); return; }
  cerrarAc();
  await buscar(raw);
}

async function buscar(query) {
  if (!puedeHacerLlamada()) { setEstado(t("errLimit"), true); return; }

  // Primero: buscar en la base de datos RD local.
  // Si hay coincidencia exacta o muy cercana, usar coordenadas precisas
  // en lugar del nombre (OWM falla con muchos municipios dominicanos por nombre).
  const nombreBase = query.split(",")[0].trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const ciudadRD = CIUDADES_RD.find(c => {
    const n = c.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return n === nombreBase || n.startsWith(nombreBase) || nombreBase.startsWith(n);
  });

  if (ciudadRD) {
    // Tenemos coordenadas exactas → usar la ruta fiable
    return buscarPorCoords(ciudadRD.lat, ciudadRD.lon, ciudadRD.name);
  }

  setEstado(t("searching"), false);
  searchBtn.disabled = true;
  mostrarLoading();
  try {
    const clima = await obtenerClimaPorNombre(query);
    lastClima  = clima;
    lastSearch = { lat: clima.lat, lon: clima.lon, nombre: clima.fullName };
    guardarHistorial(clima.fullName);
    renderHistorial();
    mostrarResultado(clima);
    setEstado("", false);
    if (heroCity) {
      heroCity.textContent = clima.fullName;
      heroCity.dataset.defaultText = "false";
      heroCity.style.color = "var(--orange)";
      setTimeout(() => heroCity && (heroCity.style.color = ""), 2000);
    }
  } catch {
    resultArea.innerHTML = "";
    setEstado(t("errNotFound"), true);
  } finally { searchBtn.disabled = false; }
}

async function buscarPorCoords(lat, lon, nombre) {
  if (!puedeHacerLlamada()) { setEstado(t("errLimit"), true); return; }
  setEstado(t("searching"), false);
  searchBtn.disabled = true;
  mostrarLoading();
  try {
    const clima = await obtenerClimaCoords(lat, lon, nombre);
    lastClima  = clima;
    lastSearch = { lat, lon, nombre };
    guardarHistorial(nombre);
    renderHistorial();
    mostrarResultado(clima);
    setEstado("", false);
    if (heroCity) {
      heroCity.textContent = clima.fullName;
      heroCity.dataset.defaultText = "false";
      heroCity.style.color = "var(--orange)";
      setTimeout(() => heroCity && (heroCity.style.color = ""), 2000);
    }
  } catch {
    resultArea.innerHTML = "";
    setEstado(t("errCoords"), true);
  } finally { searchBtn.disabled = false; }
}

// ══════════════════════════════════════════
// API CLIMA (con caché 5 min)
// ══════════════════════════════════════════
async function obtenerClimaPorNombre(query) {
  const { ciudad, codigoPais } = parsearQueryCiudad(query);
  const q = codigoPais ? `${ciudad},${codigoPais}` : ciudad;
  const cacheKey = `clima:name:${q.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(q)}&appid=${WK}&units=metric&lang=${getLangConfig().owm}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("not found");
  const datos = extraerDatos(await res.json());
  cacheSet(cacheKey, datos);
  return datos;
}

async function obtenerClimaCoords(lat, lon, nombreSeleccionado) {
  const cacheKey = `clima:coords:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    // Clonar para no mutar el objeto cacheado
    const clon = { ...cached };
    if (nombreSeleccionado) clon.fullName = nombreSeleccionado;
    return clon;
  }

  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WK}&units=metric&lang=${getLangConfig().owm}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("not found");
  const datos = extraerDatos(await res.json());
  cacheSet(cacheKey, datos);
  // Devolver clon con nombre personalizado sin tocar el caché
  if (nombreSeleccionado) return { ...datos, fullName: nombreSeleccionado };
  return datos;
}

function extraerDatos(d) {
  return {
    temp:      Math.round(d.main.temp),
    feelsLike: Math.round(d.main.feels_like),
    tempMin:   Math.round(d.main.temp_min),
    tempMax:   Math.round(d.main.temp_max),
    desc:      d.weather[0].description,
    id:        d.weather[0].id,
    country:   d.sys.country,
    fullName:  d.name,
    timezone:  d.timezone,
    lat:       d.coord.lat,
    lon:       d.coord.lon,
    humidity:  d.main.humidity,
    windSpeed: Math.round((d.wind?.speed ?? 0) * 3.6),
    windDeg:   d.wind?.deg ?? null,
    clouds:    d.clouds?.all ?? null,
    sunrise:   d.sys.sunrise,
    sunset:    d.sys.sunset,
  };
}

// ══════════════════════════════════════════
// RENDERIZAR RESULTADO
// ══════════════════════════════════════════
function mostrarResultado(clima) {
  if (clockInterval) clearInterval(clockInterval);
  if (mapObserver)   { mapObserver.disconnect(); mapObserver = null; }

  const node = tplResult.content.cloneNode(true);
  resultArea.innerHTML = "";
  resultArea.appendChild(node);

  const q = s => resultArea.querySelector(s);

  q("#cardCity").textContent    = clima.fullName;
  q("#cardCountry").textContent = nombrePais(clima.country);
  q("#tempValue").textContent   = fmtTemp(clima.temp);
  q("#weatherDesc").textContent = clima.desc;

  const feelsEl = q("#tempFeels");
  feelsEl.dataset.feelsVal = clima.feelsLike;
  feelsEl.textContent = `${t("feelsLike")} ${clima.feelsLike}°C`;

  q("#weatherEmoji").textContent = climaEmoji(clima.id, clima.clouds);

  // Badge RD si es ciudad dominicana
  if (clima.country === "DO") {
    const cityEl = q("#cardCity");
    const badge = document.createElement("span");
    badge.className = "card-rd-badge";
    badge.textContent = "🇩🇴 RD";
    cityEl.parentElement.insertBefore(badge, cityEl.nextSibling);
  }

  [ ["#clockLabel","clockLabel"],["#mapLabel","mapLabel"],["#mapLinkText","mapLink"],
    ["#statHumidityLabel","humidity"],["#statWindLabel","wind"],["#statMinMaxLabel","minMax"],
    ["#statCloudsLabel","clouds"],["#sunriseLabel","sunrise"],["#sunsetLabel","sunset"] ]
  .forEach(([s, k]) => { const el = q(s); if (el) el.textContent = t(k); });

  q("#statHumidityValue").textContent = clima.humidity != null ? `${clima.humidity}%` : "—";
  q("#statWindValue").textContent     = `${clima.windSpeed} km/h${windDir(clima.windDeg) ? " "+windDir(clima.windDeg) : ""}`;
  q("#statMinMaxValue").textContent   = `${fmtTemp(clima.tempMin)}° / ${fmtTemp(clima.tempMax)}°`;
  q("#statCloudsValue").textContent   = clima.clouds != null ? `${clima.clouds}%` : "—";
  q("#sunriseValue").textContent      = formatSunTime(clima.sunrise, clima.timezone);
  q("#sunsetValue").textContent       = formatSunTime(clima.sunset,  clima.timezone);

  // Bandera
  const flagWrap = q("#flagWrap");
  const flagImg  = q("#flagImg");
  flagImg.src = `https://flagcdn.com/w80/${clima.country.toLowerCase()}.png`;
  flagImg.onerror = () => { flagWrap.innerHTML = `<span style="font-size:1.8rem">${countryToFlag(clima.country)}</span>`; setTimeout(() => flagWrap.classList.add("visible"), 80); };
  flagImg.onload  = () => setTimeout(() => flagWrap.classList.add("visible"), 80);

  // Reloj
  dibujarTicks(q("#clockTicks"));
  currentOffset = clima.timezone;
  actualizarReloj();
  clockInterval = setInterval(actualizarReloj, 1000);

  // Botón formato hora
  const fmtBtn = q("#fmtToggleBtn");
  fmtBtn.textContent = formato12h ? "12h" : "24h";
  fmtBtn.addEventListener("click", () => {
    formato12h = !formato12h;
    fmtBtn.textContent = formato12h ? "12h" : "24h";
    localStorage.setItem("climahora-fmt", formato12h ? "12" : "24");
    fmtBtn.classList.add("btn-pulse");
    setTimeout(() => fmtBtn.classList.remove("btn-pulse"), 350);
    actualizarReloj();
    actualizarSunTimes();
  });

  // Botón °C/°F
  actualizarUnidadTemp();
  const tempBtn = q("#tempUnitToggle");
  if (tempBtn) {
    tempBtn.addEventListener("click", () => {
      unidadTemp = unidadTemp === "C" ? "F" : "C";
      localStorage.setItem("climahora-unit", unidadTemp);
      tempBtn.classList.add("btn-pulse");
      setTimeout(() => tempBtn.classList.remove("btn-pulse"), 350);
      actualizarUnidadTemp();
    });
  }

  // Mapa con lazy-load (IntersectionObserver)
  const mapFrame = q("#mapFrame");
  const mapLink  = q("#mapLink");
  const lat = clima.lat, lon = clima.lon;
  const bbox = `${lon-0.15},${lat-0.15},${lon+0.15},${lat+0.15}`;
  const mapSrc  = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
  const mapHref = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=11/${lat}/${lon}`;
  mapLink.href = mapHref;

  if ("IntersectionObserver" in window) {
    mapObserver = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        mapFrame.src = mapSrc;
        mapObserver.disconnect();
        mapObserver = null;
      }
    }, { rootMargin: "200px" });
    mapObserver.observe(mapFrame);
  } else {
    mapFrame.src = mapSrc;
  }
}

// ══════════════════════════════════════════
// RELOJ
// ══════════════════════════════════════════
function obtenerHoraLocal(offsetSeg) {
  const now = new Date();
  return new Date(now.getTime() + now.getTimezoneOffset() * 60000 + offsetSeg * 1000);
}

function actualizarReloj() {
  if (currentOffset === null) return;
  const local = obtenerHoraLocal(currentOffset);
  const h = local.getHours(), m = local.getMinutes(), s = local.getSeconds();
  const q = sel => resultArea.querySelector(sel);

  const hH = q("#hourHand"), mH = q("#minuteHand"), sH = q("#secondHand");
  if (hH) hH.style.transform = `rotate(${(h%12)*30 + m*0.5}deg)`;
  if (mH) mH.style.transform = `rotate(${m*6 + s*0.1}deg)`;
  if (sH) sH.style.transform = `rotate(${s*6}deg)`;

  const mm = String(m).padStart(2,"0"), ss = String(s).padStart(2,"0");
  let timeStr, ampmStr;
  if (formato12h) { timeStr = `${h%12||12}:${mm}:${ss}`; ampmStr = h>=12?"PM":"AM"; }
  else            { timeStr = `${String(h).padStart(2,"0")}:${mm}:${ss}`; ampmStr = ""; }

  const dT = q("#digitalTime"), dA = q("#digitalAmpm"), dD = q("#digitalDate");
  if (dT) dT.textContent = timeStr;
  if (dA) { dA.textContent = ampmStr; dA.style.display = ampmStr ? "" : "none"; }
  if (dD) dD.textContent = local.toLocaleDateString(LOCALE_MAP[idioma]||"es-ES", { weekday:"short", day:"numeric", month:"short" });
}

function dibujarTicks(group) {
  if (!group) return;
  for (let i = 0; i < 60; i++) {
    const rad = ((i*6)-90) * (Math.PI/180);
    const major = i%5===0, r1 = major?39:43, r2 = 47;
    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1", (50+r1*Math.cos(rad)).toFixed(2));
    line.setAttribute("y1", (50+r1*Math.sin(rad)).toFixed(2));
    line.setAttribute("x2", (50+r2*Math.cos(rad)).toFixed(2));
    line.setAttribute("y2", (50+r2*Math.sin(rad)).toFixed(2));
    line.setAttribute("stroke-width", major?"2.5":"1");
    line.classList.add(major?"clock-tick-major":"clock-tick");
    group.appendChild(line);
  }
}

function formatSunTime(utcTs, tzOffset) {
  if (!utcTs) return "—";
  const d = new Date((utcTs + tzOffset) * 1000);
  const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2,"0");
  if (formato12h) return `${h%12||12}:${m} ${h>=12?"PM":"AM"}`;
  return `${String(h).padStart(2,"0")}:${m}`;
}

function actualizarSunTimes() {
  if (!lastClima) return;
  const q = s => resultArea.querySelector(s);
  if (q("#sunriseValue")) q("#sunriseValue").textContent = formatSunTime(lastClima.sunrise, lastClima.timezone);
  if (q("#sunsetValue"))  q("#sunsetValue").textContent  = formatSunTime(lastClima.sunset,  lastClima.timezone);
}

// ══════════════════════════════════════════
// HISTORIAL
// ══════════════════════════════════════════
function guardarHistorial(city) {
  let h = getHistorial().filter(c => c.toLowerCase() !== city.toLowerCase());
  localStorage.setItem("climahora-historial", JSON.stringify([city, ...h].slice(0,6)));
}
function getHistorial() { return JSON.parse(localStorage.getItem("climahora-historial")||"[]"); }
function renderHistorial() {
  const items = getHistorial();
  historyArea.innerHTML = "";
  if (!items.length) return;
  const node = tplHistory.content.cloneNode(true);
  historyArea.appendChild(node);
  historyArea.querySelector("#historyTitle").textContent = t("histTitle");
  historyArea.querySelector("#clearHistory").textContent = t("clearHist");
  historyArea.querySelector("#clearHistory").addEventListener("click", () => { localStorage.removeItem("climahora-historial"); historyArea.innerHTML = ""; });
  const list = historyArea.querySelector("#historyList");
  items.forEach((city, i) => {
    const li = document.createElement("li");
    li.className = "history-item";
    li.style.animationDelay = `${i*40}ms`;
    li.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>${escHtml(city)}`;
    li.addEventListener("click", () => { cityInput.value = city; buscar(city); window.scrollTo({top:0,behavior:"smooth"}); });
    list.appendChild(li);
  });
}

// ══════════════════════════════════════════
// AUTODETECCIÓN
// ══════════════════════════════════════════
async function autodetectar() {
  try {
    const res = await fetch("https://ipapi.co/json/");
    const data = await res.json();
    if (data.city) cityInput.value = data.city;
  } catch { /* silencioso */ }
}

// ══════════════════════════════════════════
// UTILIDADES
// ══════════════════════════════════════════
function mostrarLoading() {
  resultArea.innerHTML = `<div class="loading-msg"><div class="loading-spinner"></div><span class="loading-text">${t("loading")}</span></div>`;
}
function setEstado(msg, esError) { estadoEl.textContent = msg; estadoEl.className = "estado"+(esError?" error":""); }
function escHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

// ── Clima emoji con precisión por % nubes ──
function climaEmoji(id, clouds) {
  if (id >= 200 && id <= 781) return emojiPorId(id);
  if (id >= 800 && id <= 804 && clouds != null) return emojiPorNubosidad(clouds);
  return emojiPorId(id);
}
function emojiPorNubosidad(c) {
  if (c <= 10) return "☀️"; if (c <= 25) return "🌤️"; if (c <= 50) return "⛅"; if (c <= 84) return "🌥️"; return "☁️";
}
function emojiPorId(id) {
  if (id>=200&&id<=201) return "⛈️"; if (id===202) return "🌩️";
  if (id>=210&&id<=211) return "🌩️"; if (id>=212&&id<=232) return "⛈️";
  if (id>=300&&id<=321) return "🌦️"; if (id===500||id===501) return "🌧️";
  if (id>=502&&id<=504) return "🌧️"; if (id===511) return "🌨️";
  if (id>=520&&id<=522) return "🌦️"; if (id===531) return "⛈️";
  if (id===600) return "🌨️"; if (id===601||id===602) return "❄️";
  if (id>=611&&id<=622) return "🌨️"; if (id>=701&&id<=721) return "🌫️";
  if (id===731||id===761) return "🌪️"; if (id>=741&&id<=751) return "🌫️";
  if (id===762) return "🌋"; if (id===771) return "💨"; if (id===781) return "🌪️";
  if (id===800) return "☀️"; if (id===801) return "🌤️"; if (id===802) return "⛅";
  if (id===803) return "🌥️"; if (id===804) return "☁️"; return "🌡️";
}

function countryToFlag(code) {
  if (!code||code.length!==2) return "";
  return [...code.toUpperCase()].map(c=>String.fromCodePoint(0x1F1E6-65+c.charCodeAt(0))).join("");
}
function nombrePais(code) {
  if (!code) return "";
  try { return new Intl.DisplayNames([LOCALE_MAP[idioma]||"es-ES"],{type:"region"}).of(code)||code; } catch { return code; }
}
function nombrePaisACodigo(nombre) {
  const m = {
    "república dominicana":"DO","republica dominicana":"DO","dominicana":"DO","dominicano":"DO",
    "argentina":"AR","mexico":"MX","méxico":"MX","colombia":"CO","peru":"PE","perú":"PE",
    "chile":"CL","venezuela":"VE","ecuador":"EC","bolivia":"BO","paraguay":"PY","uruguay":"UY",
    "costa rica":"CR","panama":"PA","panamá":"PA","honduras":"HN","el salvador":"SV",
    "nicaragua":"NI","guatemala":"GT","cuba":"CU","haiti":"HT","haití":"HT",
    "puerto rico":"PR","españa":"ES","spain":"ES","estados unidos":"US","united states":"US",
    "usa":"US","canada":"CA","canadá":"CA","brazil":"BR","brasil":"BR","france":"FR",
    "francia":"FR","germany":"DE","alemania":"DE","italy":"IT","italia":"IT","japan":"JP",
    "japón":"JP","china":"CN","russia":"RU","rusia":"RU","united kingdom":"GB",
    "reino unido":"GB","uk":"GB","portugal":"PT","netherlands":"NL","holanda":"NL",
    "australia":"AU","india":"IN",
  };
  return m[nombre.toLowerCase().trim()]||null;
}
function windDir(deg) {
  if (deg==null) return "";
  const dirs={es:["N","NE","E","SE","S","SO","O","NO"],en:["N","NE","E","SE","S","SW","W","NW"],fr:["N","NE","E","SE","S","SO","O","NO"],pt:["N","NE","L","SE","S","SO","O","NO"],zh:["北","东北","东","东南","南","西南","西","西北"]};
  return (dirs[idioma]||dirs.en)[Math.round(deg/45)%8];
}
