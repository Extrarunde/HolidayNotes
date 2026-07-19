const storageKey = "holiday-notes-state-v1";
const sharedAssigneeValue = "__shared__";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("holiday-notes-sync") : null;
const supabaseSettings = window.HOLIDAY_NOTES_SUPABASE || {};
let supabaseClient =
  window.supabase && supabaseSettings.url && supabaseSettings.anonKey ?
     window.supabase.createClient(supabaseSettings.url, supabaseSettings.anonKey)
    : null;
let supabaseLoadPromise = null;

let currentUser = null;
let cloudSyncEnabled = false;
let cloudSaveTimer = null;
let cloudReloadTimer = null;
let cloudChannel = null;
let cloudIsSaving = false;
let cloudIsLoading = false;
let pendingCloudReload = false;
let pendingCloudSave = false;
let cloudMutationVersion = 0;
let ignoreCloudChangesUntil = 0;
let currentProfile = null;
let authMode = "login";
let authRecoveryMode = false;
let currentView = "pack";
let activePackCategory = "";
let shouldFocusPackSlide = false;
let pendingTripItemName = "";
let pendingItemPreferredCategory = "";
let editingTripItemId = null;
let editingManageTripId = null;
let manageTripAutosaveTimer = null;
let editingTripFriendsId = null;
let editingMealId = null;
let editingMealIngredientId = null;
let mealDialogAutosaveTimer = null;
let selectedMealId = null;
let selectedMealDate = "";
let foodMode = "meals";
let mealKind = "meal";
let shoppingMode = "food";
let shoppingStatus = "open";
let currentMealDialogKind = "meal";
let expandedMealId = null;
let mealDayScrollTimer = null;
let pendingMealIngredients = [];
let pendingNewTripActivities = [];
let manageTripActivities = [];
let localModeToastTimer = null;
let localModeToastShown = false;
let appStatusToastTimer = null;
let announcedFriendRequestIds = new Set();
let deferredInstallPrompt = null;
const cloudRequestTimeoutMs = 12000;

localStorage.removeItem("holiday-notes-theme-mode-v1");
document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#1f7a63");

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const resolvedSrc = new URL(src, document.baseURI).href;
    const existing = Array.from(document.scripts).find((script) => script.src === resolvedSrc);
    if (existing) {
      if (window.supabase || existing.dataset.loaded === "true" || document.readyState !== "loading") {
        resolve();
        return;
      }
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = reject;
    document.head.append(script);
  });
}

async function initializeSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (!supabaseSettings.url || !supabaseSettings.anonKey) return null;
  if (!window.supabase && typeof globalThis.supabase !== "undefined") {
    window.supabase = globalThis.supabase;
  }
  if (!supabaseLoadPromise) {
    supabaseLoadPromise = (async () => {
      if (!window.supabase) {
        await loadScriptOnce("./public/vendor/supabase.js")
          .then(() => {
            if (!window.supabase && typeof globalThis.supabase !== "undefined") window.supabase = globalThis.supabase;
          })
          .catch(() =>
            loadScriptOnce("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2").catch(() =>
              loadScriptOnce("https://unpkg.com/@supabase/supabase-js@2")
            )
        ).catch(() => null);
      }
      if (!window.supabase && typeof globalThis.supabase !== "undefined") {
        window.supabase = globalThis.supabase;
      }
      if (window.supabase) {
        supabaseClient = window.supabase.createClient(supabaseSettings.url, supabaseSettings.anonKey);
      }
      return supabaseClient;
    })();
  }
  return supabaseLoadPromise;
}

function authUnavailableMessage() {
  if (!supabaseSettings.url || !supabaseSettings.anonKey) {
    return "Anmeldung ist gerade nicht verfügbar. Die Supabase-Konfiguration wurde nicht geladen.";
  }
  if (!window.supabase && typeof globalThis.supabase === "undefined") {
    return "Anmeldung ist gerade nicht verfügbar. Die Auth-Bibliothek konnte nicht geladen werden. Bitte Seite neu laden.";
  }
  return "Anmeldung ist gerade nicht verfügbar. Bitte Seite neu laden und Verbindung prüfen.";
}

function withTimeout(promise, message = "Die Anfrage dauert zu lange. Bitte prüfe deine Verbindung und versuche es erneut.", timeoutMs = cloudRequestTimeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").then((registration) => registration.update()).catch(() => {});
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallAppControl();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallAppControl();
  setCloudStatus("App wurde installiert.", currentUser ? "online" : "local");
});

const categories = ["Kleidung", "Dokumente", "Technik", "Hygiene", "Medizin", "Nahrung", "Freizeit"];
const tripIconChoices = ["", "☀️", "🏖️", "🏔️", "🏕️", "🏙️", "✈️", "❄️"];
const mealSlots = [
  { id: "breakfast", label: "Frühstück" },
  { id: "lunch", label: "Mittag" },
  { id: "dinner", label: "Abendessen" }
];

const vacationTypeTemplates = {
  strand: {
    label: "Strandurlaub",
    items: [
      ["Badetuch", "Freizeit"],
      ["Sonnenhut oder Cap", "Kleidung"],
      ["After-Sun-Lotion", "Hygiene"],
      ["Wasserschuhe", "Kleidung"],
      ["Strandtasche", "Freizeit"],
      ["Sonnenbrille", "Kleidung"]
    ]
  },
  stadt: {
    label: "Städtetrip",
    items: [
      ["Bequeme Tagestasche", "Freizeit"],
      ["Stadtplan oder Offline-Karten", "Technik"],
      ["Kleine Reiseapotheke", "Medizin"],
      ["Reservierungsbestätigungen", "Dokumente"],
      ["Regenschirm", "Kleidung"],
      ["Bequeme Sneaker", "Kleidung"]
    ]
  },
  camping: {
    label: "Camping",
    items: [
      ["Zelt", "Freizeit"],
      ["Schlafsack", "Freizeit"],
      ["Isomatte", "Freizeit"],
      ["Campingkocher", "Freizeit"],
      ["Taschenlampe", "Technik"],
      ["Mückenschutz", "Medizin"]
    ]
  },
  winter: {
    label: "Winterurlaub",
    items: [
      ["Thermounterwäsche", "Kleidung"],
      ["Handschuhe", "Kleidung"],
      ["Mütze und Schal", "Kleidung"],
      ["Skibrille oder Sonnenbrille", "Freizeit"],
      ["Lippenpflege", "Hygiene"],
      ["Wärmepads", "Freizeit"]
    ]
  },
  business: {
    label: "Geschäftsreise",
    items: [
      ["Laptop", "Technik"],
      ["Laptop-Ladegerät", "Technik"],
      ["Business-Outfit", "Kleidung"],
      ["Notizbuch", "Freizeit"],
      ["Visitenkarten", "Dokumente"],
      ["Reisekosten-Belege Mappe", "Dokumente"]
    ]
  },
  wandern: {
    label: "Wanderurlaub",
    items: [
      ["Wanderschuhe", "Kleidung"],
      ["Funktionsshirt", "Kleidung"],
      ["Tagesrucksack", "Freizeit"],
      ["Blasenpflaster", "Medizin"],
      ["Wanderkarte offline", "Technik"],
      ["Regenhülle für Rucksack", "Freizeit"]
    ]
  },
  roadtrip: {
    label: "Roadtrip",
    items: [
      ["Auto-Ladekabel", "Technik"],
      ["Kühltasche", "Nahrung"],
      ["Park- oder Maut-App", "Technik"],
      ["Pannenhilfe-Nummer", "Dokumente"],
      ["Reisekissen", "Freizeit"],
      ["Mülltaschen für unterwegs", "Freizeit"]
    ]
  },
  festival: {
    label: "Festival",
    items: [
      ["Ticket und Ausweis griffbereit", "Dokumente"],
      ["Gehörschutz", "Freizeit"],
      ["Poncho", "Kleidung"],
      ["Powerbank extra", "Technik"],
      ["Desinfektionsgel", "Hygiene"],
      ["Kleine Taschenlampe", "Technik"]
    ]
  },
  wellness: {
    label: "Wellness",
    items: [
      ["Bademantel", "Kleidung"],
      ["Badeschlappen", "Kleidung"],
      ["Badetasche", "Freizeit"],
      ["Pflegeprodukte", "Hygiene"],
      ["Buch oder E-Reader", "Freizeit"],
      ["Badebekleidung", "Kleidung"]
    ]
  },
  familie: {
    label: "Familienurlaub",
    items: [
      ["Kinder-Ausweise", "Dokumente"],
      ["Lieblingsspielzeug", "Freizeit"],
      ["Kinderapotheke", "Medizin"],
      ["Wechselkleidung für unterwegs", "Kleidung"],
      ["Snacks für Kinder", "Nahrung"],
      ["Feuchttuecher", "Hygiene"]
    ]
  },
  baby: {
    label: "Baby und Kleinkind",
    items: [
      ["Windeln", "Hygiene"],
      ["Feuchttuecher", "Hygiene"],
      ["Babyphone", "Technik"],
      ["Schnuller", "Freizeit"],
      ["Babybrei oder Milchpulver", "Nahrung"],
      ["Reisebett", "Freizeit"]
    ]
  }
};

const mealTemplates = [
  {
    id: "pasta",
    name: "Pasta Abend",
    note: "Einfaches Essen für den ersten Abend",
    ingredients: [
      { name: "Nudeln", quantity: "500 g" },
      { name: "Tomatensauce", quantity: "1 Glas" },
      { name: "Parmesan", quantity: "1 Stück" }
    ]
  },
  {
    id: "fruehstueck",
    name: "Frühstück",
    note: "Schnell morgens im Urlaub",
    ingredients: [
      { name: "Brötchen", quantity: "6 Stück" },
      { name: "Butter", quantity: "1 Packung" },
      { name: "Marmelade", quantity: "1 Glas" },
      { name: "Kaffee", quantity: "1 Packung" }
    ]
  },
  {
    id: "grillen",
    name: "Grillabend",
    note: "Für Ferienwohnung oder Camping",
    ingredients: [
      { name: "Grillgemüse", quantity: "1 Packung" },
      { name: "Brot", quantity: "1 Laib" },
      { name: "Grillkäse", quantity: "2 Packungen" },
      { name: "Salat", quantity: "1 Kopf" }
    ]
  },
  {
    id: "chili",
    name: "Camping Chili",
    note: "Ein Topf, wenig Aufwand",
    ingredients: [
      { name: "Kidneybohnen", quantity: "2 Dosen" },
      { name: "Mais", quantity: "1 Dose" },
      { name: "Passierte Tomaten", quantity: "1 Packung" },
      { name: "Reis", quantity: "500 g" }
    ]
  }
];

const defaultGlobalItems = [
  { id: "g-pass", name: "Reisepass oder Personalausweis", category: "Dokumente" },
  { id: "g-ticket", name: "Tickets und Buchungsbestätigungen", category: "Dokumente" },
  { id: "g-boarding-pass", name: "Boardingpässe", category: "Dokumente" },
  { id: "g-health-card", name: "Krankenversicherungskarte", category: "Dokumente" },
  { id: "g-travel-insurance", name: "Reiseversicherung", category: "Dokumente" },
  { id: "g-driver-license", name: "Führerschein", category: "Dokumente" },
  { id: "g-credit-card", name: "Kreditkarte oder EC-Karte", category: "Dokumente" },
  { id: "g-cash", name: "Bargeld", category: "Dokumente" },
  { id: "g-hotel-address", name: "Hoteladresse und Notfallkontakte", category: "Dokumente" },
  { id: "g-vaccination-card", name: "Impfpass", category: "Dokumente" },

  { id: "g-underwear", name: "Unterwäsche", category: "Kleidung" },
  { id: "g-socks", name: "Socken", category: "Kleidung" },
  { id: "g-shirts", name: "T-Shirts", category: "Kleidung" },
  { id: "g-pants", name: "Hosen", category: "Kleidung" },
  { id: "g-sweater", name: "Pullover oder Hoodie", category: "Kleidung" },
  { id: "g-jacket", name: "Jacke", category: "Kleidung" },
  { id: "g-rain-jacket", name: "Regenjacke", category: "Kleidung" },
  { id: "g-sleepwear", name: "Schlafkleidung", category: "Kleidung" },
  { id: "g-swim", name: "Badesachen", category: "Kleidung" },
  { id: "g-shoes", name: "Bequeme Schuhe", category: "Kleidung" },
  { id: "g-sandals", name: "Sandalen oder Badelatschen", category: "Kleidung" },
  { id: "g-belt", name: "Gürtel", category: "Kleidung" },
  { id: "g-cap", name: "Mütze oder Cap", category: "Kleidung" },
  { id: "g-sunglasses", name: "Sonnenbrille", category: "Kleidung" },

  { id: "g-phone", name: "Handy", category: "Technik" },
  { id: "g-charger", name: "Ladekabel und Powerbank", category: "Technik" },
  { id: "g-power-adapter", name: "Reiseadapter", category: "Technik" },
  { id: "g-headphones", name: "Kopfhörer", category: "Technik" },
  { id: "g-camera", name: "Kamera", category: "Technik" },
  { id: "g-memory-card", name: "Speicherkarte", category: "Technik" },
  { id: "g-laptop", name: "Laptop oder Tablet", category: "Technik" },
  { id: "g-laptop-charger", name: "Laptop-Ladegerät", category: "Technik" },
  { id: "g-watch-charger", name: "Smartwatch-Ladegerät", category: "Technik" },
  { id: "g-offline-maps", name: "Offline-Karten herunterladen", category: "Technik" },

  { id: "g-toothbrush", name: "Zahnbürste", category: "Hygiene" },
  { id: "g-toothpaste", name: "Zahnpasta", category: "Hygiene" },
  { id: "g-shampoo", name: "Shampoo", category: "Hygiene" },
  { id: "g-shower-gel", name: "Duschgel", category: "Hygiene" },
  { id: "g-deodorant", name: "Deo", category: "Hygiene" },
  { id: "g-razor", name: "Rasierer", category: "Hygiene" },
  { id: "g-hairbrush", name: "Bürste oder Kamm", category: "Hygiene" },
  { id: "g-sunscreen", name: "Sonnencreme", category: "Hygiene" },
  { id: "g-lip-care", name: "Lippenpflege", category: "Hygiene" },
  { id: "g-towel", name: "Handtuch", category: "Hygiene" },
  { id: "g-nail-kit", name: "Nagelschere oder Nagelfeile", category: "Hygiene" },
  { id: "g-laundry-bag", name: "Wäschebeutel", category: "Hygiene" },

  { id: "g-meds", name: "Persönliche Medikamente", category: "Medizin" },
  { id: "g-painkillers", name: "Schmerztabletten", category: "Medizin" },
  { id: "g-plasters", name: "Pflaster", category: "Medizin" },
  { id: "g-disinfectant", name: "Desinfektionsmittel", category: "Medizin" },
  { id: "g-mosquito-spray", name: "Mückenschutz", category: "Medizin" },
  { id: "g-allergy-meds", name: "Allergiemittel", category: "Medizin" },
  { id: "g-stomach-meds", name: "Magen-Darm-Mittel", category: "Medizin" },
  { id: "g-after-sun", name: "After-Sun-Lotion", category: "Medizin" },
  { id: "g-first-aid", name: "Kleine Reiseapotheke", category: "Medizin" },

  { id: "g-backpack", name: "Rucksack oder Tagesrucksack", category: "Freizeit" },
  { id: "g-book", name: "Buch oder E-Reader", category: "Freizeit" },
  { id: "g-games", name: "Kartenspiel oder Reisespiel", category: "Freizeit" },
  { id: "g-water-bottle", name: "Trinkflasche", category: "Nahrung" },
  { id: "g-snacks", name: "Snacks für unterwegs", category: "Nahrung" },
  { id: "g-neck-pillow", name: "Nackenkissen", category: "Freizeit" },
  { id: "g-earplugs", name: "Ohrstöpsel", category: "Freizeit" },
  { id: "g-sleep-mask", name: "Schlafmaske", category: "Freizeit" },
  { id: "g-umbrella", name: "Regenschirm", category: "Freizeit" },
  { id: "g-bag-lock", name: "Kofferschloss", category: "Freizeit" },
  { id: "g-shopping-bag", name: "Stoffbeutel", category: "Freizeit" }
];

const starterState = {
  activeTripId: "trip-home",
  globalItems: defaultGlobalItems,
  customTemplates: [],
  mealTemplates: [],
  friends: [],
  friendAccounts: [],
  friendRequests: [],
  trips: [
    {
      id: "trip-home",
      name: "Neue Reise",
      placeholder: true,
      destination: "",
      icon: "",
      dates: "",
      startDate: "",
      endDate: "",
      travelMethod: "",
      activities: [],
      smartContext: defaultSmartContext(),
      createdAt: new Date().toISOString(),
      completed: false,
      people: ["Ich"],
      activity: [],
      meals: [],
      items: []
    }
  ]
};

let state = loadState();

const els = {
  homeButton: document.querySelector("#homeButton"),
  createTripButton: document.querySelector("#createTripButton"),
  newTripDialog: document.querySelector("#newTripDialog"),
  newTripBackdrop: document.querySelector("#newTripBackdrop"),
  closeNewTripButton: document.querySelector("#closeNewTripButton"),
  newTripForm: document.querySelector("#newTripForm"),
  newTripNameInput: document.querySelector("#newTripNameInput"),
  newTripDestinationInput: document.querySelector("#newTripDestinationInput"),
  newTripIconInput: document.querySelector("#newTripIconInput"),
  newTripIconButtons: document.querySelectorAll(".icon-choice"),
  newTripStartInput: document.querySelector("#newTripStartInput"),
  newTripEndInput: document.querySelector("#newTripEndInput"),
  newTripDurationDaysInput: document.querySelector("#newTripDurationDaysInput"),
  newTripDurationLabel: document.querySelector("#newTripDurationLabel"),
  newTripEndPreview: document.querySelector("#newTripEndPreview"),
  newTripTravelMethodInput: document.querySelector("#newTripTravelMethodInput"),
  newTripTravelMethodButtons: document.querySelectorAll('[data-travel-scope="new"] .travel-method-button'),
  newTripActivityInput: document.querySelector("#newTripActivityInput"),
  addNewTripActivityButton: document.querySelector("#addNewTripActivityButton"),
  newTripActivityList: document.querySelector("#newTripActivityList"),
  newTripAccommodationInput: document.querySelector("#newTripAccommodationInput"),
  newTripLuggageInput: document.querySelector("#newTripLuggageInput"),
  newTripInternationalInput: document.querySelector("#newTripInternationalInput"),
  newTripChildrenInput: document.querySelector("#newTripChildrenInput"),
  newTripPetInput: document.querySelector("#newTripPetInput"),
  newTripTemplateSelect: document.querySelector("#newTripTemplateSelect"),
  newTripFriendInput: document.querySelector("#newTripFriendInput"),
  addNewTripFriendButton: document.querySelector("#addNewTripFriendButton"),
  newTripFriendsList: document.querySelector("#newTripFriendsList"),
  manageTripDialog: document.querySelector("#manageTripDialog"),
  manageTripBackdrop: document.querySelector("#manageTripBackdrop"),
  closeManageTripButton: document.querySelector("#closeManageTripButton"),
  manageTripForm: document.querySelector("#manageTripForm"),
  manageDialogTripIcon: document.querySelector("#manageDialogTripIcon"),
  manageDialogTripName: document.querySelector("#manageDialogTripName"),
  manageDialogTripDestination: document.querySelector("#manageDialogTripDestination"),
  manageDialogTripStart: document.querySelector("#manageDialogTripStart"),
  manageDialogTripEnd: document.querySelector("#manageDialogTripEnd"),
  manageDialogTripDurationDays: document.querySelector("#manageDialogTripDurationDays"),
  manageDialogTripDuration: document.querySelector("#manageDialogTripDuration"),
  manageDialogTripEndPreview: document.querySelector("#manageDialogTripEndPreview"),
  manageDialogTripTravelMethod: document.querySelector("#manageDialogTripTravelMethod"),
  manageDialogTripTravelMethodButtons: document.querySelectorAll('[data-travel-scope="manage"] .travel-method-button'),
  manageDialogTripActivityInput: document.querySelector("#manageDialogTripActivityInput"),
  addManageTripActivityButton: document.querySelector("#addManageTripActivityButton"),
  manageDialogTripActivityList: document.querySelector("#manageDialogTripActivityList"),
  manageDialogTripAccommodation: document.querySelector("#manageDialogTripAccommodation"),
  manageDialogTripLuggage: document.querySelector("#manageDialogTripLuggage"),
  manageDialogTripInternational: document.querySelector("#manageDialogTripInternational"),
  manageDialogTripChildren: document.querySelector("#manageDialogTripChildren"),
  manageDialogTripPet: document.querySelector("#manageDialogTripPet"),
  manageDialogTripFriendInput: document.querySelector("#manageDialogTripFriendInput"),
  addManageTripFriendButton: document.querySelector("#addManageTripFriendButton"),
  manageDialogTripFriendsList: document.querySelector("#manageDialogTripFriendsList"),
  manageDialogOpenPackButton: document.querySelector("#manageDialogOpenPackButton"),
  manageDialogCompleteButton: document.querySelector("#manageDialogCompleteButton"),
  manageDialogDeleteButton: document.querySelector("#manageDialogDeleteButton"),
  tripFriendsDialog: document.querySelector("#tripFriendsDialog"),
  tripFriendsBackdrop: document.querySelector("#tripFriendsBackdrop"),
  closeTripFriendsButton: document.querySelector("#closeTripFriendsButton"),
  addFriendFromTripButton: document.querySelector("#addFriendFromTripButton"),
  tripFriendsDialogTitle: document.querySelector("#tripFriendsDialogTitle"),
  tripFriendsInput: document.querySelector("#tripFriendsInput"),
  addTripFriendsButton: document.querySelector("#addTripFriendsButton"),
  tripFriendFeedback: document.querySelector("#tripFriendFeedback"),
  tripFriendsList: document.querySelector("#tripFriendsList"),
  connectionBanner: document.querySelector("#connectionBanner"),
  localModeToast: document.querySelector("#localModeToast"),
  appStatusToast: document.querySelector("#appStatusToast"),
  tripManageList: document.querySelector("#tripManageList"),
  tripTimeline: document.querySelector("#tripTimeline"),
  activeTripPanel: document.querySelector(".active-trip-panel"),
  tripList: document.querySelector("#tripList"),
  tripCount: document.querySelector("#tripCount"),
  tripPickerDialog: document.querySelector("#tripPickerDialog"),
  tripPickerBackdrop: document.querySelector("#tripPickerBackdrop"),
  closeTripPickerButton: document.querySelector("#closeTripPickerButton"),
  tripPickerList: document.querySelector("#tripPickerList"),
  newTripFromPickerButton: document.querySelector("#newTripFromPickerButton"),
  editActiveTripFromPickerButton: document.querySelector("#editActiveTripFromPickerButton"),
  templatesFold: document.querySelector("#templatesFold"),
  currentPageTitle: document.querySelector("#currentPageTitle"),
  workspace: document.querySelector(".workspace"),
  floatingActionLayer: document.querySelector("#floatingActionLayer"),
  packQuickFilters: document.querySelector("#packView .quick-filters"),
  packEmptyTripLink: document.querySelector("#packEmptyTripLink"),
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  tripNameLabels: document.querySelectorAll("[data-trip-name]"),
  searchInput: document.querySelector("#searchInput"),
  filterPanel: document.querySelector("#filterPanel"),
  filterBackdrop: document.querySelector("#filterBackdrop"),
  closeFilterButton: document.querySelector("#closeFilterButton"),
  resetFilterButton: document.querySelector("#resetFilterButton"),
  toggleFilterButton: document.querySelector("#toggleFilterButton"),
  filterButtons: document.querySelectorAll(".filter-chip"),
  categoryFilter: document.querySelector("#categoryFilter"),
  categoryPicker: document.querySelector("#categoryPicker"),
  assigneeFilter: document.querySelector("#assigneeFilter"),
  assigneePicker: document.querySelector("#assigneePicker"),
  statusFilter: document.querySelector("#statusFilter"),
  quickAddItemButton: document.querySelector("#quickAddItemButton"),
  itemDialog: document.querySelector("#itemDialog"),
  itemDialogBackdrop: document.querySelector("#itemDialogBackdrop"),
  closeItemDialogButton: document.querySelector("#closeItemDialogButton"),
  itemDialogForm: document.querySelector("#itemDialogForm"),
  itemDialogEyebrow: document.querySelector("#itemDialogEyebrow"),
  itemDialogTitle: document.querySelector("#itemDialogTitle"),
  itemDialogNameLabel: document.querySelector("#itemDialogNameLabel"),
  itemDialogNameInput: document.querySelector("#itemDialogNameInput"),
  itemDialogQuantityInput: document.querySelector("#itemDialogQuantityInput"),
  itemDialogCategorySelect: document.querySelector("#itemDialogCategorySelect"),
  itemDialogGroupInput: document.querySelector("#itemDialogGroupInput"),
  itemDialogAssigneeSelect: document.querySelector("#itemDialogAssigneeSelect"),
  itemDialogAssigneeButtons: document.querySelector("#itemDialogAssigneeButtons"),
  itemCategoryHint: document.querySelector("#itemCategoryHint"),
  itemShoppingInput: document.querySelector("#itemShoppingInput"),
  itemShoppingHint: document.querySelector("#itemShoppingHint"),
  useTemplateFromItemButton: document.querySelector("#useTemplateFromItemButton"),
  itemSettingsDialog: document.querySelector("#itemSettingsDialog"),
  itemSettingsBackdrop: document.querySelector("#itemSettingsBackdrop"),
  closeItemSettingsButton: document.querySelector("#closeItemSettingsButton"),
  itemSettingsForm: document.querySelector("#itemSettingsForm"),
  settingsItemNameInput: document.querySelector("#settingsItemNameInput"),
  settingsItemQuantityInput: document.querySelector("#settingsItemQuantityInput"),
  settingsItemGroupInput: document.querySelector("#settingsItemGroupInput"),
  settingsItemCategorySelect: document.querySelector("#settingsItemCategorySelect"),
  settingsItemAssigneeSelect: document.querySelector("#settingsItemAssigneeSelect"),
  deleteItemSettingsButton: document.querySelector("#deleteItemSettingsButton"),
  addGlobalItemForm: document.querySelector("#addGlobalItemForm"),
  saveTripTemplateForm: document.querySelector("#saveTripTemplateForm"),
  tripManageFold: document.querySelector("#tripManageFold"),
  newTemplateNameInput: document.querySelector("#newTemplateNameInput"),
  templateCountLabel: document.querySelector("#templateCountLabel"),
  templateSearchInput: document.querySelector("#templateSearchInput"),
  customTemplates: document.querySelector("#customTemplates"),
  addMissingTemplatesButton: document.querySelector("#addMissingTemplatesButton"),
  vacationTypeSelect: document.querySelector("#vacationTypeSelect"),
  addVacationTypeButton: document.querySelector("#addVacationTypeButton"),
  newGlobalItemInput: document.querySelector("#newGlobalItemInput"),
  newGlobalCategoryInput: document.querySelector("#newGlobalCategoryInput"),
  tripItems: document.querySelector("#tripItems"),
  packProgress: document.querySelector("#packProgress"),
  packProgressText: document.querySelector("#packProgressText"),
  packProgressBar: document.querySelector("#packProgressBar"),
  packSliderStatus: document.querySelector("#packSliderStatus"),
  packSliderDots: document.querySelector("#packSliderDots"),
  globalItems: document.querySelector("#globalItems"),
  shoppingItems: document.querySelector("#shoppingItems"),
  completeShoppingButton: document.querySelector("#completeShoppingButton"),
  quickAddShoppingButton: document.querySelector("#quickAddShoppingButton"),
  shoppingFilterPanel: document.querySelector("#shoppingFilterPanel"),
  shoppingFilterBackdrop: document.querySelector("#shoppingFilterBackdrop"),
  toggleShoppingFilterButton: document.querySelector("#toggleShoppingFilterButton"),
  closeShoppingFilterButton: document.querySelector("#closeShoppingFilterButton"),
  resetShoppingFilterButton: document.querySelector("#resetShoppingFilterButton"),
  shoppingModeButtons: document.querySelectorAll("[data-shopping-mode]"),
  shoppingStatusButtons: document.querySelectorAll("[data-shopping-status]"),
  shoppingSearchInput: document.querySelector("#shoppingSearchInput"),
  foodModeButtons: document.querySelectorAll("[data-food-mode]"),
  mealKindButtons: document.querySelectorAll("[data-meal-kind]"),
  foodMealsPanel: document.querySelector("#foodMealsPanel"),
  foodShoppingPanel: document.querySelector("#foodShoppingPanel"),
  foodShoppingItems: document.querySelector("#foodShoppingItems"),
  foodCompleteShoppingButton: document.querySelector("#foodCompleteShoppingButton"),
  mealTemplateForm: document.querySelector("#mealTemplateForm"),
  mealTemplateSearchInput: document.querySelector("#mealTemplateSearchInput"),
  mealTemplateSelect: document.querySelector("#mealTemplateSelect"),
  mealTemplatePreview: document.querySelector("#mealTemplatePreview"),
  mealDialogTemplateSearchInput: document.querySelector("#mealDialogTemplateSearchInput"),
  mealDialogTemplateSelect: document.querySelector("#mealDialogTemplateSelectInline") || document.querySelector("#mealDialogTemplateSelect"),
  mealDialogTemplatePreview: document.querySelector("#mealDialogTemplatePreviewInline") || document.querySelector("#mealDialogTemplatePreview"),
  useMealDialogTemplateButton: document.querySelector("#useMealDialogTemplateButton"),
  mealDayStrip: document.querySelector("#mealDayStrip"),
  mealListTitle: document.querySelector("#mealListTitle"),
  foodShoppingButton: document.querySelector("#foodShoppingButton"),
  createMealButton: document.querySelector("#createMealButton"),
  mealDialog: document.querySelector("#mealDialog"),
  mealDialogBackdrop: document.querySelector("#mealDialogBackdrop"),
  closeMealButton: document.querySelector("#closeMealButton"),
  mealForm: document.querySelector("#mealForm"),
  mealDialogTitle: document.querySelector("#mealDialogTitle"),
  mealNameLabel: document.querySelector("#mealNameLabel"),
  mealSaveButton: document.querySelector("#mealSaveButton"),
  mealNameInput: document.querySelector("#mealNameInput"),
  snackQuantityField: document.querySelector("#snackQuantityField"),
  snackQuantityInput: document.querySelector("#snackQuantityInput"),
  mealDateSelect: document.querySelector("#mealDateSelect"),
  mealSlotSelect: document.querySelector("#mealSlotSelect"),
  mealDialogPlanContext: document.querySelector("#mealDialogPlanContext"),
  mealDialogDayStrip: document.querySelector("#mealDialogDayStrip"),
  mealDialogSlotButtons: document.querySelector("#mealDialogSlotButtons"),
  mealBuilderPanel: document.querySelector("#mealBuilderPanel"),
  addMealIngredientButton: document.querySelector("#addMealIngredientButton"),
  mealIngredientList: document.querySelector("#mealIngredientList"),
  mealIngredientDialog: document.querySelector("#mealIngredientDialog"),
  mealIngredientBackdrop: document.querySelector("#mealIngredientBackdrop"),
  closeMealIngredientButton: document.querySelector("#closeMealIngredientButton"),
  mealIngredientDialogTitle: document.querySelector("#mealIngredientDialogTitle"),
  mealIngredientForm: document.querySelector("#mealIngredientForm"),
  mealIngredientNameInput: document.querySelector("#mealIngredientNameInput"),
  mealIngredientSuggestionSelect: document.querySelector("#mealIngredientSuggestionSelect"),
  mealIngredientQuantityInput: document.querySelector("#mealIngredientQuantityInput"),
  mealIngredientUnitSelect: document.querySelector("#mealIngredientUnitSelect"),
  foodIngredientForm: document.querySelector("#foodIngredientForm"),
  foodIngredientNameInput: document.querySelector("#foodIngredientNameInput"),
  foodIngredientQuantityInput: document.querySelector("#foodIngredientQuantityInput"),
  foodIngredientUnitSelect: document.querySelector("#foodIngredientUnitSelect"),
  mealDialogFoodIngredientNameInput: document.querySelector("#mealDialogFoodIngredientNameInput"),
  mealDialogFoodIngredientQuantityInput: document.querySelector("#mealDialogFoodIngredientQuantityInput"),
  mealDialogFoodIngredientUnitSelect: document.querySelector("#mealDialogFoodIngredientUnitSelect"),
  addMealDialogFoodIngredientButton: document.querySelector("#addMealDialogFoodIngredientButton"),
  mealList: document.querySelector("#mealList"),
  mealCentralActions: document.querySelector("#mealCentralActions"),
  editSelectedMealButton: document.querySelector("#editSelectedMealButton"),
  repeatSelectedMealButton: document.querySelector("#repeatSelectedMealButton"),
  deleteSelectedMealButton: document.querySelector("#deleteSelectedMealButton"),
  mealDialogActions: document.querySelector("#mealDialogActions"),
  deleteMealDialogButton: document.querySelector("#deleteMealDialogButton"),
  stats: document.querySelector("#stats"),
  addPersonForm: document.querySelector("#addPersonForm"),
  newPersonInput: document.querySelector("#newPersonInput"),
  teamSummary: document.querySelector("#teamSummary"),
  peopleList: document.querySelector("#peopleList"),
  activityCount: document.querySelector("#activityCount"),
  activityList: document.querySelector("#activityList"),
  tripOverviewPanel: document.querySelector("#tripOverviewPanel"),
  exportButton: document.querySelector("#exportButton"),
  importInput: document.querySelector("#importInput"),
  accountSignedOut: document.querySelector("#accountSignedOut"),
  openAuthButton: document.querySelector("#openAuthButton"),
  signedOutMenu: document.querySelector("#signedOutMenu"),
  signedInMenu: document.querySelector("#signedInMenu"),
  authDialog: document.querySelector("#authDialog"),
  authBackdrop: document.querySelector("#authBackdrop"),
  closeAuthButton: document.querySelector("#closeAuthButton"),
  accountSettingsDialog: document.querySelector("#accountSettingsDialog"),
  accountSettingsBackdrop: document.querySelector("#accountSettingsBackdrop"),
  closeAccountSettingsButton: document.querySelector("#closeAccountSettingsButton"),
  accountSettingsMount: document.querySelector("#accountSettingsMount"),
  authMessage: document.querySelector("#authMessage"),
  authForm: document.querySelector("#authForm"),
  authDisplayNameField: document.querySelector("#authDisplayNameField"),
  authDisplayNameInput: document.querySelector("#authDisplayNameInput"),
  authEmailField: document.querySelector("#authEmailField"),
  authEmailInput: document.querySelector("#authEmailInput"),
  authPasswordInput: document.querySelector("#authPasswordInput"),
  authPasswordConfirmField: document.querySelector("#authPasswordConfirmField"),
  authPasswordConfirmInput: document.querySelector("#authPasswordConfirmInput"),
  togglePasswordButton: document.querySelector("#togglePasswordButton"),
  loginButton: document.querySelector("#loginButton"),
  signupButton: document.querySelector("#signupButton"),
  resetPasswordButton: document.querySelector("#resetPasswordButton"),
  backToLoginButton: document.querySelector("#backToLoginButton"),
  logoutButton: document.querySelector("#logoutButton"),
  userMenu: document.querySelector("#userMenu"),
  userMenuButton: document.querySelector("#userMenuButton"),
  cloudBadge: document.querySelector("#cloudBadge"),
  cloudStatus: document.querySelector("#cloudStatus"),
  cloudActions: document.querySelector("#cloudActions"),
  accountAvatar: document.querySelector("#accountAvatar"),
  accountName: document.querySelector("#accountName"),
  accountEmail: document.querySelector("#accountEmail"),
  accountMenuAvatar: document.querySelector("#accountMenuAvatar"),
  accountProfileButton: document.querySelector("#accountProfileButton"),
  accountSyncButton: document.querySelector("#accountSyncButton"),
  profileNameInput: document.querySelector("#profileNameInput"),
  profileEmailInput: document.querySelector("#profileEmailInput"),
  changeEmailButton: document.querySelector("#changeEmailButton"),
  profilePasswordInput: document.querySelector("#profilePasswordInput"),
  profilePasswordConfirmInput: document.querySelector("#profilePasswordConfirmInput"),
  changePasswordButton: document.querySelector("#changePasswordButton"),
  profileResetPasswordButton: document.querySelector("#profileResetPasswordButton"),
  saveProfileButton: document.querySelector("#saveProfileButton"),
  accountFriendNameInput: document.querySelector("#accountFriendNameInput"),
  addAccountFriendButton: document.querySelector("#addAccountFriendButton"),
  accountFriendsList: document.querySelector("#accountFriendsList"),
  accountFriendRequests: document.querySelector("#accountFriendRequests"),
  accountFriendFeedback: document.querySelector("#accountFriendFeedback"),
  accountFriendCount: document.querySelector("#accountFriendCount"),
  deleteAccountButton: document.querySelector("#deleteAccountButton"),
  installAppButton: document.querySelector("#installAppButton"),
  installAppHint: document.querySelector("#installAppHint"),
  syncStatusText: document.querySelector("#syncStatusText"),
  syncToCloudButton: document.querySelector("#syncToCloudButton"),
  loadFromCloudButton: document.querySelector("#loadFromCloudButton"),
  enableLiveSyncButton: document.querySelector("#enableLiveSyncButton"),
  leaveTripButton: document.querySelector("#leaveTripButton"),
  itemTemplate: document.querySelector("#itemTemplate")
};

[
  els.packQuickFilters,
  els.toggleShoppingFilterButton,
  els.quickAddItemButton,
  els.quickAddShoppingButton,
  els.foodShoppingButton,
  els.createMealButton,
  els.createTripButton
].filter(Boolean).forEach((control) => els.floatingActionLayer?.append(control));
document.body.dataset.activeView = currentView;

function updateConnectionBanner() {
  if (els.connectionBanner) els.connectionBanner.hidden = true;
  const online = navigator.onLine;
  showStatusToast(online ? (currentUser ? "Cloud erreichbar" : "Lokal gespeichert - nicht eingeloggt") : "Offline - lokal gespeichert", online && currentUser ? "online" : "local");
  if (online && pendingCloudSave && cloudSyncEnabled && currentUser) scheduleCloudSave();
  if (els.connectionBanner) els.connectionBanner.textContent = "Offline · lokal gespeichert";
  els.connectionBanner.hidden = true;
}

function isStandaloneApp() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function updateInstallAppControl() {
  if (!els.installAppButton || !els.installAppHint) return;
  const installed = isStandaloneApp();
  els.installAppButton.hidden = installed;
  els.installAppButton.textContent = deferredInstallPrompt ? "App installieren" : "Installationshilfe";
  if (installed) {
    els.installAppHint.textContent = "Die App ist auf diesem Gerät installiert.";
  } else if (deferredInstallPrompt) {
    els.installAppHint.textContent = "Installiere Holiday Notes für einen schnelleren Start vom Home-Bildschirm.";
  } else if (isIosDevice()) {
    els.installAppHint.textContent = "iPhone: Safari öffnen, Teilen antippen und „Zum Home-Bildschirm“ wählen.";
  } else {
    els.installAppHint.textContent = "Öffne die App im Browser-Menü und wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.";
  }
}

function showStatusToast(message, type = "local") {
  if (!els.appStatusToast || !message) return;
  window.clearTimeout(appStatusToastTimer);
  els.appStatusToast.textContent = message;
  els.appStatusToast.hidden = false;
  els.appStatusToast.classList.toggle("online", type === "online");
  els.appStatusToast.classList.toggle("error", type === "error");
  els.appStatusToast.classList.toggle("local", type !== "online" && type !== "error");
  window.setTimeout(() => els.appStatusToast.classList.add("visible"), 20);
  appStatusToastTimer = window.setTimeout(() => {
    els.appStatusToast.classList.remove("visible");
    window.setTimeout(() => {
      if (!els.appStatusToast.classList.contains("visible")) els.appStatusToast.hidden = true;
    }, 240);
  }, 3400);
}

function showLocalModeToast() {
  showStatusToast("Nicht eingeloggt - lokal gespeichert", "local");
  return;
  if (!els.localModeToast) return;
  window.clearTimeout(localModeToastTimer);
  els.localModeToast.textContent = "Nicht eingeloggt · lokal";
  els.localModeToast.hidden = false;
  window.setTimeout(() => els.localModeToast.classList.add("visible"), 20);
  localModeToastTimer = window.setTimeout(() => {
    els.localModeToast.classList.remove("visible");
    window.setTimeout(() => {
      if (!els.localModeToast.classList.contains("visible")) els.localModeToast.hidden = true;
    }, 220);
  }, 3600);
}

const swipeViewOrder = ["pack", "shopping", "food", "manage"];

function activateView(viewName, options = {}) {
  const nextView = viewName === "global" ? "manage" : viewName;
  const previousView = currentView;
  if (nextView === "food") foodMode = "meals";
  currentView = nextView;
  document.body.dataset.activeView = nextView;
  els.userMenu.open = false;
  const activeTab = nextView === "people" ? "manage" : nextView;
  els.tabs.forEach((entry) => entry.classList.toggle("active", entry.dataset.view === activeTab));
  let activatedView = null;
  els.views.forEach((view) => {
    const active = view.id === `${nextView}View`;
    view.classList.toggle("active", active);
    view.classList.remove("view-enter-from-left", "view-enter-from-right");
    if (active) activatedView = view;
  });
  if (activatedView && previousView !== nextView && options.animate !== false) {
    const previousIndex = swipeViewOrder.indexOf(previousView);
    const nextIndex = swipeViewOrder.indexOf(nextView);
    const direction = options.direction || (previousIndex >= 0 && nextIndex >= 0 && nextIndex < previousIndex ? "left" : "right");
    activatedView.classList.add(direction === "left" ? "view-enter-from-left" : "view-enter-from-right");
    window.setTimeout(() => activatedView.classList.remove("view-enter-from-left", "view-enter-from-right"), 220);
  }
  updateFoodModeUi();
  updatePageTitle();
  updatePackEmptyTripLink(activeTrip());
  renderTrips(activeTrip());
}

function updatePageTitle() {
  if (!els.currentPageTitle) return;
  const titles = {
    pack: "Packliste",
    shopping: "Einkaufsliste",
    food: "Essen",
    manage: "Reisen",
    people: "Konto"
  };
  els.currentPageTitle.textContent = titles[currentView] || "Packliste";
}

function updatePackEmptyTripLink(trip = activeTrip()) {
  if (!els.packEmptyTripLink) return;
  els.packEmptyTripLink.hidden = currentView !== "pack" || !isPlaceholderTrip(trip);
}

function setFoodMode(mode) {
  foodMode = "meals";
  updateFoodModeUi();
}

function updateFoodModeUi() {
  if (els.foodMealsPanel) els.foodMealsPanel.hidden = false;
  if (els.foodShoppingPanel) els.foodShoppingPanel.hidden = true;
  if (els.createMealButton) els.createMealButton.hidden = !canEditActiveTrip();
  if (els.foodShoppingButton) els.foodShoppingButton.hidden = true;
  els.foodModeButtons.forEach((button) => {
    const active = button.dataset.foodMode === "meals";
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function setMealKind(kind) {
  mealKind = kind === "snack" ? "snack" : "meal";
  expandedMealId = null;
  updateMealKindUi();
  renderMealsCompact(activeTrip());
}

function updateMealKindUi() {
  els.mealKindButtons.forEach((button) => {
    const active = button.dataset.mealKind === mealKind;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function setShoppingMode(mode) {
  shoppingMode = mode === "other" ? "other" : "food";
  updateShoppingModeUi();
  renderShoppingItems(activeTrip());
}

function setShoppingStatus(status) {
  shoppingStatus = ["all", "open", "bought"].includes(status) ? status : "open";
  updateShoppingModeUi();
  renderShoppingItems(activeTrip());
}

function addMealIngredientToShoppingList(mealId, ingredientIndex) {
  if (!requireEditableActiveTrip()) return;
  const trip = activeTrip();
  const meal = (trip.meals || []).find((entry) => entry.id === mealId);
  const ingredient = meal?.ingredients?.[ingredientIndex];
  if (!meal || !ingredient?.name) {
    setCloudStatus("Zutat nicht gefunden.", "error");
    return;
  }
  const existing = trip.items.find((item) => item.category === "Nahrung" && normalizeTemplateName(item.name) === normalizeTemplateName(ingredient.name));
  const wasShopping = Boolean(existing?.shopping);
  ingredient.itemId = ensureShoppingIngredient(trip, ingredient, meal.name);
  addActivityToTrip(trip, `${ingredient.name} zur Einkaufsliste hinzugefügt`);
  commit();
  setCloudStatus(
    wasShopping ? `${ingredient.name} ist schon auf der Einkaufsliste.` : `${ingredient.name} zur Einkaufsliste hinzugefügt.`,
    currentUser ? "online" : "local"
  );
}

function updateShoppingModeUi() {
  els.shoppingModeButtons.forEach((button) => {
    const active = button.dataset.shoppingMode === shoppingMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  els.shoppingStatusButtons.forEach((button) => {
    const active = button.dataset.shoppingStatus === shoppingStatus;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  updateShoppingFilterToggleState();
}

function updateShoppingFilterToggleState() {
  if (!els.toggleShoppingFilterButton) return;
  const hasFilters = Boolean(
    (els.shoppingSearchInput?.value || "").trim() ||
    shoppingMode !== "food" ||
    shoppingStatus !== "open"
  );
  const modeLabel = shoppingMode === "food" ? "Essen" : "Alles andere";
  const statusLabels = { open: "Offen", all: "Alle", bought: "Gekauft" };
  els.toggleShoppingFilterButton.classList.toggle("has-filters", hasFilters);
  els.toggleShoppingFilterButton.setAttribute("aria-label", `Einkaufsfilter öffnen, ${modeLabel}, ${statusLabels[shoppingStatus] || "Offen"}`);
  els.toggleShoppingFilterButton.setAttribute("title", `Filter: ${modeLabel}, ${statusLabels[shoppingStatus] || "Offen"}`);
}

function openTemplatesArea() {
  activateView("manage");
  els.templatesFold.open = true;
  window.setTimeout(() => els.templatesFold.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
}

function makeItem(name, category, assignee = "Ich", options = {}) {
  return {
    id: crypto.randomUUID(),
    name,
    category,
    assignee,
    packed: false,
    missing: false,
    shopping: false,
    bought: false,
    quantity: "",
    note: "",
    group: "",
    ...options
  };
}

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return structuredClone(starterState);
  try {
    return withDefaultGlobalItems(JSON.parse(saved));
  } catch {
    return structuredClone(starterState);
  }
}

function withDefaultGlobalItems(savedState) {
  const stateWithDefaults = savedState || structuredClone(starterState);
  removeExampleTripFromState(stateWithDefaults);
  stateWithDefaults.globalItems ||= [];
  stateWithDefaults.customTemplates ||= [];
  stateWithDefaults.mealTemplates ||= [];
  stateWithDefaults.friends = normalizeFriendList(stateWithDefaults.friends || []);
  stateWithDefaults.friendAccounts = normalizeFriendAccounts(stateWithDefaults.friendAccounts || []);
  stateWithDefaults.friendRequests = normalizeFriendRequests(stateWithDefaults.friendRequests || []);
  removeDeveloperTestPeople(stateWithDefaults);
  const existingByName = new Map();
  stateWithDefaults.globalItems.forEach((item) => {
    const normalizedName = normalizeTemplateName(item.name);
    if (!existingByName.has(normalizedName)) existingByName.set(normalizedName, item);
  });
  defaultGlobalItems.forEach((item) => {
    const normalizedName = normalizeTemplateName(item.name);
    const existingItem = existingByName.get(normalizedName);
    if (existingItem) {
      existingItem.name = item.name;
      existingItem.category = item.category;
    } else {
      stateWithDefaults.globalItems.push(structuredClone(item));
      existingByName.set(normalizedName, item);
    }
  });
  const seenNames = new Set();
  stateWithDefaults.globalItems = stateWithDefaults.globalItems.filter((item) => {
    const normalizedName = normalizeTemplateName(item.name);
    if (seenNames.has(normalizedName)) return false;
    seenNames.add(normalizedName);
    return true;
  });
  stateWithDefaults.trips ||= [];
  stateWithDefaults.trips.forEach((trip, index) => {
    trip.completed = Boolean(trip.completed);
    trip.createdAt ||= new Date(Date.now() - index * 86400000).toISOString();
    trip.icon ||= "";
    trip.startDate ||= "";
    trip.endDate ||= "";
    trip.travelMethod ||= "";
    trip.activities ||= [];
    trip.smartContext = normalizeSmartContext(trip.smartContext);
    trip.meals ||= [];
    trip.people ||= ["Ich"];
    trip.meals.forEach((meal) => {
      meal.date ||= "";
      meal.slot ||= "dinner";
    });
  });
  return stateWithDefaults;
}

function isDeveloperTestPersonName(value) {
  const normalized = normalizeFriendName(value).toLowerCase();
  return normalized.includes("codex") || normalized === "test" || normalized === "konto test";
}

function removeDeveloperTestPeople(stateToClean) {
  stateToClean.friends = normalizeFriendList(stateToClean.friends || []).filter((friend) => !isDeveloperTestPersonName(friend));
  stateToClean.friendAccounts = normalizeFriendAccounts(stateToClean.friendAccounts || []).filter((friend) => !isDeveloperTestPersonName(friend.name || friend.email));
  (stateToClean.trips || []).forEach((trip) => {
    trip.people = normalizeFriendList(trip.people || ["Ich"]).filter((person) => !isDeveloperTestPersonName(displayAssignee(person)));
    if (!trip.people.length) trip.people = ["Ich"];
    trip.items = (trip.items || []).map((item) => {
      if (isDeveloperTestPersonName(item.assignee)) item.assignee = "Ich";
      return item;
    });
  });
}

function removeExampleTripFromState(stateToClean) {
  stateToClean.trips ||= [];
  const filteredTrips = stateToClean.trips.filter((trip) => trip.id !== "trip-madeira");
  if (filteredTrips.length !== stateToClean.trips.length) {
    stateToClean.trips = filteredTrips;
    if (stateToClean.activeTripId === "trip-madeira") {
      stateToClean.activeTripId = stateToClean.trips[0]?.id || starterState.activeTripId;
    }
  }
  if (!stateToClean.trips.length) {
    const freshTrip = structuredClone(starterState.trips[0]);
    freshTrip.id = crypto.randomUUID();
    stateToClean.trips = [freshTrip];
    stateToClean.activeTripId = freshTrip.id;
  }
}

function normalizeTemplateName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/g, " ");
}

function saveState(announce = true) {
  localStorage.setItem(storageKey, JSON.stringify(state));
  if (announce && channel) channel.postMessage(state);
}

function activeTrip() {
  return state.trips.find((trip) => trip.id === state.activeTripId) ?? state.trips[0];
}

function addActivity(text) {
  const trip = activeTrip();
  addActivityToTrip(trip, text);
}

function addActivityToTrip(trip, text) {
  trip.activity = [
    {
      id: crypto.randomUUID(),
      message: `${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} ${text}`
    },
    ...(trip.activity || []).map(normalizeActivityEntry)
  ].slice(0, 20);
}

function normalizeActivityEntry(entry) {
  if (typeof entry === "string") return { id: crypto.randomUUID(), message: entry };
  return {
    id: entry.id || crypto.randomUUID(),
    message: entry.message || ""
  };
}

function createEmptyTrip(name = "Neue Reise", options = {}) {
  return {
    id: crypto.randomUUID(),
    name,
    placeholder: Boolean(options.placeholder),
    destination: "",
    icon: "",
    dates: "",
    startDate: "",
    endDate: "",
    travelMethod: "",
    activities: [],
    smartContext: defaultSmartContext(),
    createdAt: new Date().toISOString(),
    completed: false,
    people: ["Ich"],
    activity: ["Liste erstellt"],
    meals: [],
    items: []
  };
}

function defaultSmartContext() {
  return {
    accommodation: "",
    luggage: "",
    international: false,
    children: false,
    pet: false
  };
}

function isPlaceholderTrip(trip) {
  if (!trip) return true;
  if (trip.placeholder || trip.id === "trip-home") return true;
  return (
    trip.name === "Neue Reise" &&
    !trip.destination &&
    !trip.startDate &&
    !trip.endDate &&
    !(trip.items || []).length &&
    !(trip.meals || []).length &&
    !(trip.friendIds || []).length &&
    !(trip.activities || []).length &&
    !trip.ownerId
  );
}

function actualTrips() {
  return state.trips.filter((trip) => !isPlaceholderTrip(trip));
}

function normalizeSmartContext(context = {}) {
  return {
    accommodation: context.accommodation || "",
    luggage: context.luggage || "",
    international: Boolean(context.international),
    children: Boolean(context.children),
    pet: Boolean(context.pet)
  };
}

function setNewTripSmartContext(context = defaultSmartContext()) {
  const normalized = normalizeSmartContext(context);
  if (els.newTripAccommodationInput) els.newTripAccommodationInput.value = normalized.accommodation;
  if (els.newTripLuggageInput) els.newTripLuggageInput.value = normalized.luggage;
  if (els.newTripInternationalInput) els.newTripInternationalInput.checked = normalized.international;
  if (els.newTripChildrenInput) els.newTripChildrenInput.checked = normalized.children;
  if (els.newTripPetInput) els.newTripPetInput.checked = normalized.pet;
}

function readNewTripSmartContext() {
  return normalizeSmartContext({
    accommodation: els.newTripAccommodationInput.value || "",
    luggage: els.newTripLuggageInput.value || "",
    international: els.newTripInternationalInput.checked,
    children: els.newTripChildrenInput.checked,
    pet: els.newTripPetInput.checked
  });
}

function setManageTripSmartContext(context = defaultSmartContext()) {
  const normalized = normalizeSmartContext(context);
  if (els.manageDialogTripAccommodation) els.manageDialogTripAccommodation.value = normalized.accommodation;
  if (els.manageDialogTripLuggage) els.manageDialogTripLuggage.value = normalized.luggage;
  if (els.manageDialogTripInternational) els.manageDialogTripInternational.checked = normalized.international;
  if (els.manageDialogTripChildren) els.manageDialogTripChildren.checked = normalized.children;
  if (els.manageDialogTripPet) els.manageDialogTripPet.checked = normalized.pet;
}

function readManageTripSmartContext() {
  return normalizeSmartContext({
    accommodation: els.manageDialogTripAccommodation.value || "",
    luggage: els.manageDialogTripLuggage.value || "",
    international: els.manageDialogTripInternational.checked,
    children: els.manageDialogTripChildren.checked,
    pet: els.manageDialogTripPet.checked
  });
}

function openNewTripDialog() {
  if (!requireSignedInForEdit()) return;
  closeTripPicker();
  renderNewTripTemplateOptions();
  els.newTripNameInput.value = "";
  if (els.newTripDestinationInput) els.newTripDestinationInput.value = "";
  els.newTripIconInput.value = "";
  els.newTripStartInput.value = "";
  els.newTripEndInput.value = "";
  if (els.newTripDurationDaysInput) els.newTripDurationDaysInput.value = "";
  if (els.newTripTravelMethodInput) els.newTripTravelMethodInput.value = "";
  setTravelMethod("new", "");
  if (els.newTripActivityInput) els.newTripActivityInput.value = "";
  pendingNewTripActivities = [];
  renderActivityChips(els.newTripActivityList, pendingNewTripActivities);
  setNewTripSmartContext();
  setNewTripIcon("");
  updateNewTripDuration();
  els.newTripTemplateSelect.value = "none";
  if (els.newTripFriendInput) els.newTripFriendInput.value = "";
  if (els.newTripFriendsList) els.newTripFriendsList.dataset.selectedFriendIds = "";
  renderTripFriendPicker(els.newTripFriendsList, []);
  els.newTripDialog.hidden = false;
  window.setTimeout(() => els.newTripNameInput.focus(), 0);
}

function closeNewTripDialog() {
  els.newTripDialog.hidden = true;
}

function openTripPicker() {
  if (!requireSignedInForEdit()) return;
  renderTripPicker();
  els.tripPickerDialog.hidden = false;
}

function closeTripPicker() {
  els.tripPickerDialog.hidden = true;
}

function openFilterDialog() {
  els.filterPanel.hidden = false;
  els.toggleFilterButton.classList.add("active");
  els.toggleFilterButton.setAttribute("aria-expanded", "true");
  window.setTimeout(() => els.searchInput.focus(), 0);
}

function closeFilterDialog() {
  els.filterPanel.hidden = true;
  els.toggleFilterButton.classList.remove("active");
  els.toggleFilterButton.setAttribute("aria-expanded", "false");
}

function openShoppingFilterDialog() {
  els.shoppingFilterPanel.hidden = false;
  els.toggleShoppingFilterButton.classList.add("active");
  els.toggleShoppingFilterButton.setAttribute("aria-expanded", "true");
  window.setTimeout(() => els.shoppingSearchInput?.focus(), 0);
}

function closeShoppingFilterDialog() {
  els.shoppingFilterPanel.hidden = true;
  els.toggleShoppingFilterButton.classList.remove("active");
  els.toggleShoppingFilterButton.setAttribute("aria-expanded", "false");
}

function resetShoppingFilters() {
  if (els.shoppingSearchInput) els.shoppingSearchInput.value = "";
  shoppingMode = "food";
  shoppingStatus = "open";
  updateShoppingModeUi();
  renderShoppingItems(activeTrip());
}

function resetPackFilters() {
  els.searchInput.value = "";
  els.categoryFilter.value = "all";
  if (els.assigneeFilter) els.assigneeFilter.value = "all";
  setStatusFilter("all");
  renderCategoryPicker();
  renderAssigneeFilter();
  render();
}

function hasCachedAuthSession() {
  if (!supabaseSettings.url || !supabaseSettings.anonKey) return false;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) || "";
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const data = JSON.parse(localStorage.getItem(key) || "null");
      const session = data?.currentSession || data;
      if (!session?.access_token) continue;
      if (session.expires_at && session.expires_at * 1000 < Date.now()) continue;
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function canEditLists() {
  return Boolean(currentUser || hasCachedAuthSession());
}

function hasEditableActiveTrip() {
  return !isPlaceholderTrip(activeTrip());
}

function canEditActiveTrip() {
  return canEditLists() && hasEditableActiveTrip();
}

function requireSignedInForEdit() {
  if (canEditLists()) return true;
  setCloudStatus("Bitte melde dich an, um Änderungen zu speichern.", "local");
  openAuthDialog();
  return false;
}

function requireEditableActiveTrip() {
  if (!requireSignedInForEdit()) return false;
  if (hasEditableActiveTrip()) return true;
  setCloudStatus("Lege zuerst eine Reise an, bevor du Einträge hinzufügen kannst.", "local");
  activateView("manage");
  openNewTripDialog();
  return false;
}

function updateEditAvailability() {
  const signedIn = canEditLists();
  const editable = canEditActiveTrip();
  document.body.classList.toggle("has-no-active-trip", !hasEditableActiveTrip());
  [
    els.completeShoppingButton,
    els.foodCompleteShoppingButton,
    els.newTripFromPickerButton,
    els.editActiveTripFromPickerButton,
    els.addNewTripActivityButton,
    els.addManageTripActivityButton,
    els.addMissingTemplatesButton,
    els.addVacationTypeButton,
    els.leaveTripButton,
    els.importInput
  ].filter(Boolean).forEach((button) => {
    button.disabled = !signedIn;
  });
  [
    els.quickAddItemButton,
    els.quickAddShoppingButton,
    els.createMealButton
  ].filter(Boolean).forEach((button) => {
    button.disabled = !editable;
    button.hidden = !editable;
  });
  if (els.quickAddItemButton) els.quickAddItemButton.hidden = !editable;
  if (els.quickAddShoppingButton) els.quickAddShoppingButton.hidden = !editable;
  if (els.createMealButton) els.createMealButton.hidden = !editable;
}

function openItemDialog(name = "", defaults = {}) {
  if (!requireEditableActiveTrip()) return;
  pendingTripItemName = name.trim();
  const isFoodContext = defaults.mode === "food" || defaults.category === "Nahrung" || defaults.group === "Lebensmittel";
  if (els.itemDialogEyebrow) els.itemDialogEyebrow.textContent = isFoodContext ? "Essen" : "Packliste";
  if (els.itemDialogTitle) els.itemDialogTitle.textContent = isFoodContext ? "Essen hinzufügen" : "Gegenstand hinzufügen";
  if (els.itemDialogNameLabel) els.itemDialogNameLabel.textContent = isFoodContext ? "Essen" : "Gegenstand";
  if (els.itemDialogNameInput) els.itemDialogNameInput.placeholder = isFoodContext ? "z. B. Wasser, Brot, Snacks" : "";
  if (els.itemShoppingHint) els.itemShoppingHint.textContent = isFoodContext ? "Wird direkt in die Einkaufsliste übernommen." : "Kommt zusätzlich auf die Einkaufsliste.";
  pendingItemPreferredCategory = categories.includes(defaults.category) ?
     defaults.category
    : categories.includes(activePackCategory) ?
     activePackCategory
    : categories.includes(els.categoryFilter.value)
      ? els.categoryFilter.value
      : "";
  els.itemDialogNameInput.value = pendingTripItemName;
  if (els.itemDialogQuantityInput) els.itemDialogQuantityInput.value = "";
  els.itemDialogCategorySelect.innerHTML = categories.map((category) => `<option>${escapeHtml(category)}</option>`).join("");
  els.itemDialogGroupInput.value = defaults.group || estimateItemGroup(pendingTripItemName, pendingItemPreferredCategory || els.categoryFilter.value);
  const people = peopleForAssignment();
  els.itemDialogAssigneeSelect.innerHTML = assigneeOptionsHtml(people);
  els.itemDialogAssigneeSelect.value = defaultAssignee();
  renderItemDialogAssigneeButtons(people);
  updateItemDialogCategoryHint();
  els.itemShoppingInput.checked = Boolean(defaults.shopping);
  els.itemDialog.hidden = false;
  window.setTimeout(() => {
    if (!pendingTripItemName) {
      els.itemDialogNameInput.focus();
      return;
    }
    const estimate = estimateCategory(els.itemDialogNameInput.value.trim());
    if (estimate.confident) {
      els.itemShoppingInput.focus();
    } else {
      els.itemDialogCategorySelect.focus();
    }
  }, 0);
}

function renderItemDialogAssigneeButtons(people = peopleForAssignment()) {
  if (!els.itemDialogAssigneeButtons || !els.itemDialogAssigneeSelect) return;
  const current = els.itemDialogAssigneeSelect.value || defaultAssignee();
  const options = [...people, sharedAssigneeValue];
  els.itemDialogAssigneeButtons.innerHTML = options
    .map((person) => {
      const active = person === current;
      const label = person === sharedAssigneeValue ? sharedAssigneeLabel(people) : person;
      return `<button class="item-assignee-button ${active ? "active" : ""}" data-assignee="${escapeHtml(person)}" type="button" aria-pressed="${active}" style="--assignee-color: ${escapeHtml(assigneeColor(person))}"><span aria-hidden="true"></span><strong>${escapeHtml(label)}</strong></button>`;
    })
    .join("");
}

function updateItemDialogCategoryHint() {
  const name = els.itemDialogNameInput.value.trim();
  const estimate = estimateCategory(name);
  const category = pendingItemPreferredCategory || estimate.category;
  els.itemDialogCategorySelect.value = category;
  if (!els.itemDialogGroupInput.value.trim()) {
    els.itemDialogGroupInput.value = estimateItemGroup(name, category);
  }
  els.itemCategoryHint.textContent = name
    ? pendingItemPreferredCategory
      ? `Kategorie aus dem Reiter ${category} übernommen.`
      : estimate.confident
        ? `Kategorie wurde als ${estimate.category} erkannt.`
        : "Kategorie bitte kurz prüfen."
    : "Name eingeben, Kategorie wird vorgeschlagen.";
}

function closeItemDialog() {
  els.itemDialog.hidden = true;
  pendingItemPreferredCategory = "";
}

function saveItemFromDialog() {
  if (!requireEditableActiveTrip()) return;
  const name = els.itemDialogNameInput.value.trim();
  if (!name) return;
  const category = els.itemDialogCategorySelect.value;
  rememberItemCategory(name, category);
  activeTrip().items.push(makeItem(name, category, els.itemDialogAssigneeSelect.value || defaultAssignee(), {
    shopping: els.itemShoppingInput.checked,
    quantity: els.itemDialogQuantityInput.value.trim() || "",
    group: els.itemDialogGroupInput.value.trim() || estimateItemGroup(name, category)
  }));
  els.searchInput.value = "";
  if (els.assigneeFilter) els.assigneeFilter.value = "all";
  setStatusFilter("all");
  addActivity(`${name} hinzugefügt`);
  els.itemDialogNameInput.value = "";
  if (els.itemDialogQuantityInput) els.itemDialogQuantityInput.value = "";
  els.itemDialogGroupInput.value = "";
  els.itemShoppingInput.checked = false;
  updateItemDialogCategoryHint();
  commit();
  window.setTimeout(() => els.itemDialogNameInput.focus(), 0);
}

function openItemSettingsDialog(item) {
  if (!requireSignedInForEdit()) return;
  editingTripItemId = item.id;
  els.settingsItemNameInput.value = item.name;
  els.settingsItemQuantityInput.value = item.quantity || "";
  els.settingsItemGroupInput.value = item.group || estimateItemGroup(item.name, item.category);
  els.settingsItemCategorySelect.innerHTML = categories.map((category) => `<option>${escapeHtml(category)}</option>`).join("");
  els.settingsItemCategorySelect.value = categories.includes(item.category) ? item.category : "Freizeit";
  const people = peopleForAssignment();
  els.settingsItemAssigneeSelect.innerHTML = assigneeOptionsHtml(people);
  els.settingsItemAssigneeSelect.value = item.assignee === sharedAssigneeValue ? sharedAssigneeValue : displayAssignee(item.assignee);
  els.itemSettingsDialog.hidden = false;
  window.setTimeout(() => els.settingsItemNameInput.focus(), 0);
}

function closeItemSettingsDialog() {
  editingTripItemId = null;
  els.itemSettingsDialog.hidden = true;
}

function saveItemSettingsDialog() {
  if (!requireSignedInForEdit()) return;
  const trip = activeTrip();
  const item = trip.items.find((entry) => entry.id === editingTripItemId);
  const name = els.settingsItemNameInput.value.trim();
  if (!item || !name) return;
  const category = els.settingsItemCategorySelect.value;
  rememberItemCategory(name, category);
  Object.assign(item, {
    name,
    quantity: els.settingsItemQuantityInput.value.trim(),
    group: els.settingsItemGroupInput.value.trim(),
    category,
    assignee: els.settingsItemAssigneeSelect.value || defaultAssignee()
  });
  addActivity(`${name} bearbeitet`);
  closeItemSettingsDialog();
  commit();
}

function deleteCurrentItemFromSettings() {
  if (!requireSignedInForEdit()) return;
  const trip = activeTrip();
  const item = trip.items.find((entry) => entry.id === editingTripItemId);
  if (!item) return;
  trip.items = trip.items.filter((entry) => entry.id !== item.id);
  addActivity(`${item.name} entfernt`);
  closeItemSettingsDialog();
  commit();
}

function renderNewTripTemplateOptions() {
  const customOptions = (state.customTemplates || [])
    .map((template) => `<option value="custom:${escapeHtml(template.id)}">Eigene Vorlage: ${escapeHtml(template.name)}</option>`)
    .join("");
  const tripOptions = actualTrips()
    .map((trip) => `<option value="trip:${escapeHtml(trip.id)}">Alte Reise: ${escapeHtml(trip.name)}</option>`)
    .join("");
  els.newTripTemplateSelect.innerHTML = `
    <option value="none">Ohne Vorlage starten</option>
    ${customOptions}
    ${tripOptions}
  `;
}

function tripDaysForPacking(trip) {
  const duration = calculateTripDuration(trip.startDate, trip.endDate);
  return duration && !duration.invalid ? duration.days : 0;
}

function clothingQuantityForTrip(itemName, days) {
  if (!days) return "";
  const normalized = normalizeTemplateName(itemName);
  if (normalized.includes("unterwaesche") || normalized.includes("socken") || normalized.includes("t shirts")) return `${days}x`;
  if (normalized.includes("hosen")) return `${Math.max(1, Math.ceil(days / 3))}x`;
  if (normalized.includes("pullover") || normalized.includes("hoodie")) return `${Math.max(1, Math.ceil(days / 4))}x`;
  if (normalized.includes("schlafkleidung")) return "1x";
  if (normalized.includes("badesachen")) return "1x";
  return "";
}

function generalTripTemplateItems(trip, assignee) {
  const days = tripDaysForPacking(trip);
  return state.globalItems.map((item) => makeItem(item.name, item.category, assignee, {
    quantity: item.category === "Kleidung" ? clothingQuantityForTrip(item.name, days) : ""
  }));
}

function openAccountSettings() {
  els.userMenu.open = false;
  if (!currentUser) {
    openAuthDialog();
    return;
  }
  els.accountSettingsDialog.hidden = false;
  els.accountSettingsMount?.querySelectorAll("details.activity-fold").forEach((fold) => {
    fold.open = false;
  });
}

function openAccountFriendsSettings() {
  openAccountSettings();
  const friendsFold = els.accountFriendNameInput?.closest("details.activity-fold");
  if (friendsFold) friendsFold.open = true;
  window.setTimeout(() => els.accountFriendNameInput?.focus(), 180);
}

function closeAccountSettings() {
  if (els.accountSettingsDialog) els.accountSettingsDialog.hidden = true;
}

function mountAccountSettingsPanel() {
  if (!els.accountSettingsMount) return;
  const sourcePanel = document.querySelector(".team-account-panel");
  if (!sourcePanel) return;
  const folds = Array.from(sourcePanel.querySelectorAll(":scope > details.activity-fold"));
  folds.slice(0, 6).forEach((fold) => els.accountSettingsMount.append(fold));
  setupExclusiveFolds(els.accountSettingsMount);
  sourcePanel.classList.add("activity-only");
  const settingsFold = document.querySelector(".team-settings-fold");
  const settingsTitle = settingsFold?.querySelector(".settings-summary > span:first-child");
  if (settingsTitle) settingsTitle.textContent = "Aktivität";
  const remainingFolds = sourcePanel.querySelectorAll(":scope > details.activity-fold");
  if (!remainingFolds.length) {
    if (settingsFold) settingsFold.hidden = true;
  }
}

function setupExclusiveFolds(container) {
  if (!container) return;
  container.querySelectorAll(":scope > details.activity-fold").forEach((fold) => {
    fold.addEventListener("toggle", () => {
      if (!fold.open) return;
      container.querySelectorAll(":scope > details.activity-fold").forEach((other) => {
        if (other !== fold) other.open = false;
      });
    });
  });
}

function saveFromAccountMenu() {
  els.userMenu.open = false;
  if (!currentUser) {
    openAuthDialog();
    return;
  }
  uploadStateToCloud().catch((error) => console.error(error));
}

function createTripFromDialog() {
  if (!requireSignedInForEdit()) return;
  const name = els.newTripNameInput.value.trim() || "Neue Reise";
  const trip = createEmptyTrip(name, { placeholder: false });
  trip.destination = els.newTripDestinationInput.value.trim() || "";
  trip.icon = sanitizeTripIcon(els.newTripIconInput.value);
  trip.startDate = els.newTripStartInput.value;
  trip.endDate = els.newTripEndInput.value;
  trip.dates = formatTripDateRange(trip.startDate, trip.endDate);
  trip.travelMethod = els.newTripTravelMethodInput.value || "";
  trip.activities = [...pendingNewTripActivities];
  trip.smartContext = readNewTripSmartContext();
  applyNewTripTemplate(trip, els.newTripTemplateSelect.value);
  trip.people = tripPeopleFromSelectedFriends(selectedFriendsFromPicker(els.newTripFriendsList), trip);
  trip.friendIds = selectedFriendIdsFromPicker(els.newTripFriendsList);
  state.trips = actualTrips();
  state.trips.unshift(trip);
  state.activeTripId = trip.id;
  closeNewTripDialog();
  commit();
  activateView("pack");
}

function applyNewTripTemplate(trip, templateValue) {
  const assignee = defaultAssignee(trip);
  if (templateValue.startsWith("custom:")) {
    const template = (state.customTemplates || []).find((entry) => entry.id === templateValue.replace("custom:", ""));
    if (!template) return;
    trip.items = template.items.map((item) => makeItem(item.name, item.category, assignee, {
      shopping: Boolean(item.shopping),
      quantity: item.quantity || "",
      note: item.note || "",
      group: item.group || ""
    }));
    trip.activity.unshift(`${template.name}-Vorlage übernommen`);
    return;
  }
  if (templateValue === "global") {
    trip.items = state.globalItems.map((item) => makeItem(item.name, item.category, assignee));
    trip.activity.unshift("Globale Packliste übernommen");
    return;
  }
  if (templateValue.startsWith("vacation:")) {
    const preset = vacationTypeTemplates[templateValue.replace("vacation:", "")];
    if (!preset) return;
    trip.items = preset.items.map(([name, category]) => makeItem(name, category, assignee));
    trip.activity.unshift(`${preset.label}-Vorlage übernommen`);
    return;
  }
  if (templateValue.startsWith("trip:")) {
    const sourceTrip = state.trips.find((entry) => entry.id === templateValue.replace("trip:", ""));
    if (!sourceTrip) return;
    trip.items = sourceTrip.items.map((item) => ({
      ...structuredClone(item),
      id: crypto.randomUUID(),
      packed: false,
      bought: false
    }));
    trip.people = Array.from(new Set(["Ich", ...(sourceTrip.people || [])]));
    trip.activity.unshift(`${sourceTrip.name} als Vorlage übernommen`);
  }
}

function toggleTripCompleted(tripId = state.activeTripId) {
  if (!requireSignedInForEdit()) return;
  const trip = state.trips.find((entry) => entry.id === tripId) || activeTrip();
  trip.completed = !trip.completed;
  addActivityToTrip(trip, trip.completed ? "Reise abgeschlossen" : "Reise wieder geöffnet");
  commit();
}

async function deleteTrip(tripId = state.activeTripId) {
  if (!requireSignedInForEdit()) return;
  const trip = state.trips.find((entry) => entry.id === tripId) || activeTrip();
  const confirmed = window.confirm(`"${trip.name}" löschen?`);
  if (!confirmed) return;

  if (supabaseClient && currentUser && isUuid(trip.id)) {
    setCloudStatus("Lösche Reise...", "online");
    const { error } = await supabaseClient.from("trips").delete().eq("id", trip.id);
    if (error) {
      const message = error.code === "42501" ?
         "Nur der Besitzer darf löschen."
        : error.message || "Reise konnte nicht gelöscht werden.";
      setCloudStatus(message, "error");
      throw error;
    }
    removeTripLocally(trip.id);
    setCloudStatus("Reise gelöscht.", "online");
    return;
  }

  removeTripLocally(trip.id);
  setCloudStatus("Reise gelöscht.", currentUser ? "online" : "local");
}

function removeTripLocally(tripId) {
  state.trips = state.trips.filter((entry) => entry.id !== tripId);
  if (!state.trips.length) state.trips.push(createEmptyTrip("Neue Reise", { placeholder: true }));
  state.activeTripId = state.trips[0].id;
  saveState();
  render();
}

function render() {
  const trip = activeTrip();
  state.activeTripId = trip.id;
  state.friends = normalizeFriendList(state.friends || []);
  updateEditAvailability();
  renderViewTripNames(trip);
  renderCategoryFilter();
  renderTrips(trip);
  renderInvite(trip);
  renderStats(trip);
  renderPackProgress(trip);
  renderTripItems(trip);
  renderGlobalItems(trip);
  renderCustomTemplates(trip);
  renderShoppingItems(trip);
  renderMealsCompact(trip);
  renderMealTemplateOptions();
  renderPendingMealIngredients();
  renderTripTimeline();
  renderTripOverview(trip);
  renderManageTrips();
  renderPeople(trip);
  renderAccountFriends();
  updatePageTitle();
  updateFilterToggleState();
  saveState(false);
}

function renderViewTripNames(trip) {
  const destination = trip.destination ? ` · ${trip.destination}` : "";
  els.tripNameLabels.forEach((label) => {
    label.textContent = `${tripIcon(trip) ? `${tripIcon(trip)} ` : ""}${trip.name}${destination}`;
  });
}

function renderTrips(active) {
  els.activeTripPanel.hidden = true;
  return;
  els.tripCount.textContent = String(state.trips.length);
  els.tripList.innerHTML = "";
  const canSwitchHere = currentView === "manage";
  const summary = document.createElement(canSwitchHere ? "button" : "div");
  summary.className = `trip-switch-summary ${canSwitchHere ? "" : "trip-readonly-summary"}`;
  if (canSwitchHere) {
    summary.type = "button";
    summary.addEventListener("click", openTripPicker);
  }
  summary.innerHTML = tripCardHtml(active, true);
  els.tripList.append(summary);
  renderTripPicker();
}

function renderTripPicker() {
  els.tripPickerList.innerHTML = "";
  const currentTrip = activeTrip();
  actualTrips()
    .slice()
    .sort((a, b) => Number(a.completed) - Number(b.completed))
    .forEach((trip) => {
      const button = document.createElement("button");
      button.className = `trip-button ${trip.id === state.activeTripId ? "active" : ""}`;
      button.type = "button";
      button.innerHTML = tripCardHtml(trip, trip.id === state.activeTripId);
      button.addEventListener("click", () => {
        if (!requireSignedInForEdit()) return;
        if (trip.id === state.activeTripId) {
          closeTripPicker();
          openManageTripDialog(trip.id);
          return;
        }
        state.activeTripId = trip.id;
        render();
        renderTripPicker();
      });
      els.tripPickerList.append(button);
    });
}

function setStatusFilter(status) {
  els.statusFilter.value = status;
  const labels = { all: "Alle", missing: "Offene", shopping: "Einkauf" };
  els.toggleFilterButton.setAttribute("aria-label", `Filter öffnen, Status: ${labels[status] || "Alle"}`);
  els.toggleFilterButton.setAttribute("title", `Filter: ${labels[status] || "Alle"}`);
  updateFilterToggleState();
  els.filterButtons.forEach((button) => {
    const isActive = button.dataset.status === status;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function updateFilterToggleState() {
  if (!els.toggleFilterButton) return;
  const hasFilters = Boolean(
    (els.searchInput?.value || "").trim() ||
    (els.categoryFilter?.value && els.categoryFilter.value !== "all") ||
    (els.assigneeFilter?.value && els.assigneeFilter.value !== "all") ||
    (els.statusFilter?.value && els.statusFilter.value !== "all")
  );
  els.toggleFilterButton.classList.toggle("has-filters", hasFilters);
}

function tripCardHtml(trip, active) {
  const total = trip.items.length;
  const packed = trip.items.filter((item) => item.packed).length;
  const open = trip.items.filter((item) => !item.packed).length;
  const progress = total ? Math.round((packed / total) * 100) : 0;
  const icon = tripIcon(trip);
  const dates = displayTripDates(trip);
  const planMeta = tripPlanMeta(trip);
  return `
    <span class="trip-card-title">${icon ? `<span class="trip-icon" aria-hidden="true">${escapeHtml(icon)}</span>` : ""}${escapeHtml(trip.name)}${trip.completed ? ` <span class="trip-state-badge">Abgeschlossen</span>` : ""}</span>
    <span class="trip-card-meta">${escapeHtml(dates)}</span>
    <span class="trip-card-meta">${planMeta ? escapeHtml(planMeta) : "&nbsp;"}</span>
    <span class="trip-card-progress" aria-hidden="true"><span style="width: ${progress}%"></span></span>
    <span class="trip-card-foot">${packed}/${total} gepackt${open ? ` · ${open} offen` : ""}</span>
  `;
}

function tripIcon(trip) {
  return sanitizeTripIcon(trip.icon);
}

function displayTripDates(trip) {
  return trip.dates || formatTripDateRange(trip.startDate, trip.endDate) || "Kein Zeitraum";
}

function tripPlanMeta(trip) {
  return (trip.activities || []).slice(0, 2).join(" · ");
}

function deriveDestinationFromTripTitle(title) {
  const words = title.split(/\s+/).filter(Boolean);
  return words[0] || "";
}

function formatTripDateRange(startDate, endDate) {
  const start = formatDateInput(startDate);
  const end = formatDateInput(endDate);
  if (start && end) return `${start} bis ${end}`;
  return start || end || "";
}

function formatDateInput(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return "";
  return `${day}.${month}.${year}`;
}

function dateInputFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToDateInput(value, days) {
  const date = new Date(`${value}T00:00:00`);
  if (!value || Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return dateInputFromDate(date);
}

function calculateTripDuration(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diffDays = Math.round((end - start) / 86400000);
  if (diffDays < 0) return { invalid: true };
  return {
    days: diffDays + 1,
    nights: diffDays
  };
}

function calculateTripEndDate(startDate, daysValue) {
  const nights = Number.parseInt(daysValue, 10);
  if (!startDate || !Number.isFinite(nights) || nights < 1) return "";
  const date = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + nights);
  return dateInputFromDate(date);
}

function tripDurationDaysFromDates(startDate, endDate) {
  const duration = calculateTripDuration(startDate, endDate);
  if (!duration || duration.invalid) return "";
  return String(Math.max(1, duration.nights));
}

function tripDurationLabel(startDate, endDate) {
  const duration = calculateTripDuration(startDate, endDate);
  if (!duration) return "Nächte eintragen";
  if (duration.invalid) return "Datum prüfen";
  return `${duration.nights} ${duration.nights === 1 ? "Nacht" : "Nächte"} · ${duration.days} ${duration.days === 1 ? "Tag" : "Tage"}`;
}

function updateNewTripDuration() {
  const endDate = calculateTripEndDate(els.newTripStartInput.value, els.newTripDurationDaysInput.value);
  els.newTripEndInput.value = endDate;
  const duration = calculateTripDuration(els.newTripStartInput.value, endDate);
  if (els.newTripEndPreview) els.newTripEndPreview.hidden = true;
  if (!duration) {
    els.newTripDurationLabel.textContent = "Nächte eintragen";
    els.newTripDurationLabel.classList.remove("error");
    return;
  }
  if (duration.invalid) {
    els.newTripDurationLabel.textContent = "Datum prüfen";
    els.newTripDurationLabel.classList.add("error");
    return;
  }
  els.newTripDurationLabel.classList.remove("error");
  els.newTripDurationLabel.textContent = tripDurationLabel(els.newTripStartInput.value, endDate);
}

function renderActivityChips(container, activities) {
  if (!container) return;
  container.innerHTML = activities
    .map((activity, index) => `<button class="activity-chip" data-activity-index="${index}" type="button">${escapeHtml(activity)} <span aria-hidden="true">x</span></button>`)
    .join("");
}

function addActivityDraft(scope) {
  if (!requireSignedInForEdit()) return;
  const isManage = scope === "manage";
  const input = isManage ? els.manageDialogTripActivityInput : els.newTripActivityInput;
  const list = isManage ? manageTripActivities : pendingNewTripActivities;
  const value = input.value.trim();
  if (!value) return;
  if (!list.some((entry) => entry.toLowerCase() === value.toLowerCase())) list.push(value);
  input.value = "";
  renderActivityChips(isManage ? els.manageDialogTripActivityList : els.newTripActivityList, list);
  input.focus();
}

function removeActivityDraft(scope, index) {
  if (!requireSignedInForEdit()) return;
  const list = scope === "manage" ? manageTripActivities : pendingNewTripActivities;
  list.splice(index, 1);
  renderActivityChips(scope === "manage" ? els.manageDialogTripActivityList : els.newTripActivityList, list);
}

function setNewTripIcon(icon) {
  els.newTripIconInput.value = icon;
  els.newTripIconButtons.forEach((button) => {
    const isActive = button.dataset.icon === icon;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function setTravelMethod(scope, method) {
  const input = scope === "manage" ? els.manageDialogTripTravelMethod : els.newTripTravelMethodInput;
  const buttons = scope === "manage" ? els.manageDialogTripTravelMethodButtons : els.newTripTravelMethodButtons;
  if (input) input.value = method || "";
  buttons.forEach((button) => {
    const active = (button.dataset.method || "") === (method || "");
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function sanitizeTripIcon(value = "") {
  return Array.from(String(value).trim()).slice(0, 2).join("");
}

function renderInvite(trip) {
  if (els.leaveTripButton) {
    const isCloudOwner = Boolean(currentUser && trip.ownerId === currentUser.id);
    els.leaveTripButton.hidden = isCloudOwner;
    els.leaveTripButton.textContent = currentUser ? "Reise verlassen" : "Reise von diesem Gerät entfernen";
  }
}

async function createInviteCode() {
  setCloudStatus("Freunde werden jetzt direkt in der Reise zugewiesen.", currentUser ? "online" : "local");
}

function renderCategoryFilter() {
  const current = els.categoryFilter.value || "all";
  els.categoryFilter.innerHTML = `<option value="all">Alle Kategorien</option>${categories
    .map((category) => `<option value="${category}">${category}</option>`)
    .join("")}`;
  els.categoryFilter.value = categories.includes(current) ? current : "all";
  renderAssigneeFilter();
  renderCategoryPicker();
}

function profileDisplayName() {
  return (
    currentProfile?.display_name ||
    currentUser?.user_metadata?.display_name ||
    currentUser?.email?.split("@")[0] ||
    ""
  ).trim();
}

function accountToastName() {
  return profileDisplayName() || "dein Konto";
}

function displayAssignee(name) {
  const value = String(name || "").trim();
  if (!value) return "Alle";
  if (value === sharedAssigneeValue) return peopleForAssignment().length === 2 ? "Beide" : "Alle";
  if (value === "Ich") return profileDisplayName() || "Ich";
  return value;
}

function isOwnPersonName(name) {
  const value = normalizeFriendName(name).toLowerCase();
  if (!value) return false;
  const ownNames = [
    "Ich",
    profileDisplayName(),
    currentProfile?.display_name,
    currentUser?.user_metadata?.display_name,
    currentUser?.email?.split("@")[0]
  ].map((entry) => normalizeFriendName(entry).toLowerCase()).filter(Boolean);
  return ownNames.includes(value);
}

function normalizeFriendName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeFriendList(friends = []) {
  const seen = new Set();
  return friends
    .map(normalizeFriendName)
    .filter((friend) => {
      const key = friend.toLowerCase();
      if (!friend || isDeveloperTestPersonName(friend) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeFriendAccounts(accounts = []) {
  const seen = new Set();
  return accounts
    .map((account) => ({
      id: String(account?.id || account?.friend_id || "").trim(),
      name: normalizeFriendName(account?.name || account?.display_name || account?.email || ""),
      email: String(account?.email || "").trim().toLowerCase()
    }))
    .filter((account) => {
      if (!isUuid(account.id) || !account.name || isDeveloperTestPersonName(account.name || account.email) || seen.has(account.id)) return false;
      seen.add(account.id);
      return true;
    });
}

function normalizeFriendRequests(requests = []) {
  const seen = new Set();
  return requests
    .map((request) => ({
      id: String(request?.id || request?.request_id || "").trim(),
      direction: request?.direction === "incoming" ? "incoming" : "outgoing",
      name: normalizeFriendName(request?.name || request?.display_name || request?.email || ""),
      email: String(request?.email || "").trim().toLowerCase()
    }))
    .filter((request) => isUuid(request.id) && request.name && !seen.has(request.id) && !isDeveloperTestPersonName(request.name))
    .filter((request) => {
      seen.add(request.id);
      return true;
    });
}

function friendAccounts() {
  state.friendAccounts = normalizeFriendAccounts(state.friendAccounts || []);
  return state.friendAccounts;
}

function friendOptions() {
  const accounts = friendAccounts().map((account) => ({ ...account, linked: true }));
  const linkedNames = new Set(accounts.map((account) => account.name.toLowerCase()));
  const localFriends = (currentUser ? [] : accountFriends())
    .filter((name) => !linkedNames.has(name.toLowerCase()))
    .map((name) => ({ id: "", name, email: "", linked: false }));
  return [...accounts, ...localFriends];
}

function accountFriends() {
  state.friends = normalizeFriendList(state.friends || []);
  return state.friends;
}

function friendRequests() {
  state.friendRequests = normalizeFriendRequests(state.friendRequests || []);
  return state.friendRequests;
}

function setFriendFeedback(message = "", type = "info") {
  [els.accountFriendFeedback, els.tripFriendFeedback].forEach((element) => {
    if (!element) return;
    element.hidden = !message;
    element.textContent = message;
    element.classList.toggle("error", type === "error");
    element.classList.toggle("success", type === "success");
  });
}

function mergeAccountFriendsFromProfile() {
  const profileFriends = normalizeFriendList(currentUser?.user_metadata?.holiday_notes_friends || []);
  const merged = normalizeFriendList([...(state.friends || []), ...profileFriends]);
  const changed = merged.join("\u0000") !== normalizeFriendList(state.friends || []).join("\u0000");
  state.friends = merged;
  return changed;
}

async function syncAccountFriendsToProfile() {
  if (!supabaseClient || !currentUser) return;
  const friends = accountFriends();
  const { data, error } = await supabaseClient.auth.updateUser({
    data: {
      ...(currentUser.user_metadata || {}),
      holiday_notes_friends: friends
    }
  });
  if (error) {
    console.warn("Freundeliste konnte nicht im Login-Profil gespeichert werden.", error);
    return;
  }
  currentUser = data?.user || currentUser;
}

async function loadFriendAccountsFromCloud() {
  if (!supabaseClient || !currentUser || !navigator.onLine) return false;
  const [friendResult, requestResult] = await Promise.allSettled([
    withTimeout(supabaseClient.rpc("list_my_friends"), "Freunde konnten gerade nicht geladen werden. Du bist trotzdem angemeldet."),
    withTimeout(supabaseClient.rpc("list_my_friend_requests"), "Freundschaftsanfragen konnten gerade nicht geladen werden.")
  ]);
  const { data: friendData, error: friendError } = friendResult.status === "fulfilled"
    ? friendResult.value
    : { data: null, error: friendResult.reason };
  const { data: requestData, error: requestError } = requestResult.status === "fulfilled"
    ? requestResult.value
    : { data: null, error: requestResult.reason };
  if (friendError) {
    if (!isMissingCloudFieldError(friendError) && friendError.code !== "PGRST202") {
      console.warn("Verknüpfte Freunde konnten nicht geladen werden.", friendError);
    }
    return false;
  }
  if (requestError && !isMissingCloudFieldError(requestError) && requestError.code !== "PGRST202") {
    console.warn("Freundschaftsanfragen konnten nicht geladen werden.", requestError);
  }
  const accounts = normalizeFriendAccounts(friendData || []);
  state.friendAccounts = accounts;
  state.friends = normalizeFriendList([...accountFriends(), ...accounts.map((account) => account.name)]);
  if (!requestError) {
    state.friendRequests = normalizeFriendRequests(requestData || []);
    const newIncomingRequest = state.friendRequests.find(
      (request) => request.direction === "incoming" && !announcedFriendRequestIds.has(request.id)
    );
    state.friendRequests.filter((request) => request.direction === "incoming").forEach((request) => announcedFriendRequestIds.add(request.id));
    if (newIncomingRequest) {
      window.setTimeout(() => setCloudStatus(`Neue Freundschaftsanfrage von ${newIncomingRequest.name}.`, "online"), 250);
    }
  }
  return true;
}

async function addFriendToAccount(value) {
  if (!requireSignedInForEdit()) return false;
  const friend = normalizeFriendName(value);
  if (!friend) {
    setFriendFeedback("Bitte gib eine E-Mail-Adresse ein.", "error");
    return false;
  }
  if (isOwnPersonName(friend) || friend.toLowerCase() === String(currentUser?.email || "").trim().toLowerCase()) {
    setFriendFeedback("Dich selbst musst du nicht als Freund hinzufügen.", "error");
    setCloudStatus("Dich selbst musst du nicht als Freund hinzufügen.", "error");
    return false;
  }
  if (!friend.includes("@")) {
    setFriendFeedback("Bitte verwende die E-Mail-Adresse des Freundes.", "error");
    setCloudStatus("Bitte verwende die E-Mail-Adresse des Freundes.", "error");
    return false;
  }
  if (supabaseClient && currentUser && navigator.onLine) {
    let data;
    let error;
    try {
      ({ data, error } = await Promise.race([
        supabaseClient.rpc("send_friend_request_by_email", { friend_email: friend }),
        new Promise((resolve) => window.setTimeout(() => resolve({
          data: null,
          error: { code: "FRIEND_TIMEOUT", message: "Die Freundesuche dauert zu lange. Bitte versuche es erneut." }
        }), 8000))
      ]));
    } catch (requestError) {
      setFriendFeedback("Freundesuche gerade nicht erreichbar. Bitte prüfe die Cloud-Verbindung.", "error");
      setCloudStatus(
        friendlyCloudError(requestError, "Freund konnte nicht hinzugefügt werden. Prüfe bitte deine Internetverbindung."),
        "error"
      );
      return false;
    }
    if (error) {
      if (isMissingCloudFieldError(error) || error.code === "PGRST202") {
        setFriendFeedback("Die Freundesfunktion wird noch eingerichtet. Bitte führe das neue Supabase-Schema aus.", "error");
        setCloudStatus("Die Freundefunktion benötigt das aktuelle Supabase-Schema.", "error");
        return false;
      }
      setFriendFeedback(friendlyCloudError(error, "Freund konnte nicht gefunden werden."), "error");
      setCloudStatus(friendlyCloudError(error, "Freund konnte nicht gefunden werden."), "error");
      return false;
    }
    const response = Array.isArray(data) ? data[0] : data;
    const account = normalizeFriendAccounts([response])[0];
    if (!account || !response) {
      setFriendFeedback("Freund konnte nicht gefunden werden.", "error");
      setCloudStatus("Freund konnte nicht gefunden werden.", "error");
      return false;
    }
    await loadFriendAccountsFromCloud();
    renderAccountFriends();
    if (response.relationship_status === "accepted") {
      setFriendFeedback(`${account.name} ist bereits dein Freund.`, "success");
      setCloudStatus(`${account.name} ist bereits dein Freund.`, "online");
      return { name: account.name, accepted: true };
    }
    if (response.relationship_status === "incoming") {
      setFriendFeedback(`${account.name} wartet auf deine Antwort in den Einstellungen.`, "success");
      setCloudStatus(`${account.name} wartet auf deine Antwort in den Einstellungen.`, "online");
      return { name: account.name, pending: true };
    }
    setFriendFeedback(`Freundschaftsanfrage an ${account.name} gesendet.`, "success");
    setCloudStatus(`Freundschaftsanfrage an ${account.name} gesendet.`, "online");
    return { name: account.name, pending: true };
  }
  setFriendFeedback("Freundschaftsanfragen brauchen eine Internetverbindung.", "error");
  setCloudStatus("Freundschaftsanfragen brauchen eine Internetverbindung.", "error");
  return false;
}

async function removeFriendFromAccount(friend, friendId = "") {
  if (!requireSignedInForEdit()) return;
  const target = normalizeFriendName(friend).toLowerCase();
  if (!target) return;
  state.friends = accountFriends().filter((entry) => entry.toLowerCase() !== target);
  if (friendId) {
    state.friendAccounts = friendAccounts().filter((entry) => entry.id !== friendId);
    if (supabaseClient && currentUser && navigator.onLine) {
      const { error } = await supabaseClient.rpc("remove_friend", { friend_user_id: friendId });
      if (error) console.warn("Freund konnte nicht aus der Cloud entfernt werden.", error);
    }
  }
  state.trips.forEach((trip) => {
    trip.people = (trip.people || []).filter((person) => normalizeFriendName(displayAssignee(person)).toLowerCase() !== target);
    if (friendId) trip.friendIds = (trip.friendIds || []).filter((id) => id !== friendId);
  });
  commit();
  syncAccountFriendsToProfile().catch((error) => console.warn("Freundeliste konnte nicht synchronisiert werden.", error));
}

async function respondToFriendRequest(requestId, accept) {
  if (!requireSignedInForEdit() || !isUuid(requestId) || !supabaseClient || !navigator.onLine) return;
  const request = friendRequests().find((entry) => entry.id === requestId);
  const { error } = await supabaseClient.rpc("respond_to_friend_request", {
    target_request_id: requestId,
    accept_request: Boolean(accept)
  });
  if (error) {
    setFriendFeedback(friendlyCloudError(error, "Die Freundschaftsanfrage konnte nicht beantwortet werden."), "error");
    setCloudStatus(friendlyCloudError(error, "Die Freundschaftsanfrage konnte nicht beantwortet werden."), "error");
    return;
  }
  await loadFriendAccountsFromCloud();
  commit();
  const message = accept ? `${request?.name || "Freundschaftsanfrage"} angenommen.` : "Freundschaftsanfrage abgelehnt.";
  setFriendFeedback(message, "success");
  setCloudStatus(message, "online");
}

function renderAccountFriends() {
  const options = friendOptions();
  if (els.accountFriendCount) els.accountFriendCount.textContent = String(options.length);
  if (els.accountFriendRequests) {
    const requests = friendRequests();
    els.accountFriendRequests.innerHTML = requests.length
      ? `
        <p class="friend-request-title">${requests.some((request) => request.direction === "incoming") ? "Offene Freundschaftsanfragen" : "Gesendete Freundschaftsanfragen"}</p>
        ${requests.map((request) => request.direction === "incoming" ? `
          <article class="friend-request-card">
            <div><strong>${escapeHtml(request.name)}</strong><span>möchte mit dir befreundet sein</span></div>
            <div class="friend-request-actions">
              <button type="button" data-friend-response="accept" data-request-id="${escapeHtml(request.id)}">Annehmen</button>
              <button type="button" data-friend-response="reject" data-request-id="${escapeHtml(request.id)}">Ablehnen</button>
            </div>
          </article>
        ` : `
          <article class="friend-request-card friend-request-outgoing">
            <div><strong>${escapeHtml(request.name)}</strong><span>Anfrage gesendet</span></div>
          </article>
        `).join("")}
      `
      : "";
  }
  if (!els.accountFriendsList) return;
  if (!options.length) {
    els.accountFriendsList.innerHTML = `<span class="empty-inline">Noch keine bestätigten Freunde.</span>`;
    renderTripFriendPicker(els.newTripFriendsList, selectedFriendsFromPicker(els.newTripFriendsList));
    renderTripFriendPicker(els.manageDialogTripFriendsList, selectedFriendsFromPicker(els.manageDialogTripFriendsList));
    renderTripFriendPicker(els.tripFriendsList, selectedFriendsFromPicker(els.tripFriendsList));
    return;
  }
  els.accountFriendsList.innerHTML = options
    .map((friend) => `
      <button class="activity-chip friend-chip" data-remove-friend="${escapeHtml(friend.name)}" data-friend-id="${escapeHtml(friend.id)}" type="button">
        ${escapeHtml(friend.name)} <span aria-hidden="true">x</span>
      </button>
    `)
    .join("");
  renderTripFriendPicker(els.newTripFriendsList, selectedFriendsFromPicker(els.newTripFriendsList));
  renderTripFriendPicker(els.manageDialogTripFriendsList, selectedFriendsFromPicker(els.manageDialogTripFriendsList));
  renderTripFriendPicker(els.tripFriendsList, selectedFriendsFromPicker(els.tripFriendsList));
}

function selectedFriendsFromPicker(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll("[data-trip-friend].active")).map((button) => button.dataset.tripFriend || "");
}

function selectedFriendIdsFromPicker(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll("[data-trip-friend].active"))
    .map((button) => button.dataset.friendId || "")
    .filter(isUuid);
}

function renderTripFriendPicker(container, selected = []) {
  if (!container) return;
  const selectedFriends = normalizeFriendList(
    (selected || []).map(displayAssignee).filter((friend) => friend && !isOwnPersonName(friend))
  );
  const options = friendOptions();
  const knownNames = new Set(options.map((friend) => friend.name.toLowerCase()));
  selectedFriends.forEach((name) => {
    if (!knownNames.has(name.toLowerCase())) options.push({ id: "", name, email: "", linked: false });
  });
  const selectedKeys = new Set((selected || []).map((friend) => normalizeFriendName(displayAssignee(friend)).toLowerCase()));
  const selectedIds = new Set(container.dataset.selectedFriendIds?.split(",").filter(Boolean) || []);
  if (!options.length) {
    container.innerHTML = `<span class="empty-inline">Noch keine bestätigten Freunde. Füge Freunde zuerst in den Konto-Einstellungen hinzu.</span>`;
    return;
  }
  container.innerHTML = options
    .map((friend) => {
      const active = selectedKeys.has(friend.name.toLowerCase()) || (friend.id && selectedIds.has(friend.id));
      return `
        <button class="activity-chip friend-chip ${active ? "active" : ""}" data-trip-friend="${escapeHtml(friend.name)}" data-friend-id="${escapeHtml(friend.id)}" type="button" aria-pressed="${active}">
          ${escapeHtml(friend.name)}${friend.linked ? " · Konto" : ""}
        </button>
      `;
    })
    .join("");
}

function tripPeopleFromSelectedFriends(selectedFriends, trip = activeTrip()) {
  const profileName = profileDisplayName() || "Ich";
  const selected = normalizeFriendList(selectedFriends);
  const selectedKeys = new Set(selected.map((friend) => friend.toLowerCase()));
  const removedKeys = new Set(
    (trip.people || [])
      .map(displayAssignee)
      .filter((person) => person && !isOwnPersonName(person) && !selectedKeys.has(person.toLowerCase()))
      .map((person) => person.toLowerCase())
  );
  (trip.items || []).forEach((item) => {
    if (removedKeys.has(displayAssignee(item.assignee).toLowerCase())) item.assignee = profileName;
  });
  return Array.from(new Set([profileName, ...selected].filter(Boolean)));
}

function peopleForAssignment(trip = activeTrip()) {
  const profileName = profileDisplayName();
  return Array.from(new Set([
    profileName || "Ich",
    ...(trip.people || []).map(displayAssignee),
    ...trip.items.filter((item) => item.assignee !== sharedAssigneeValue).map((item) => displayAssignee(item.assignee))
  ].filter((person) => person && person !== "Alle")));
}

function sharedAssigneeLabel(people = peopleForAssignment()) {
  return people.length === 2 ? "Beide" : "Alle";
}

function assigneeOptionsHtml(people = peopleForAssignment()) {
  return [
    ...people.map((person) => `<option value="${escapeHtml(person)}">${escapeHtml(person)}</option>`),
    `<option value="${sharedAssigneeValue}">${sharedAssigneeLabel(people)}</option>`
  ].join("");
}

function defaultAssignee(trip = activeTrip()) {
  return peopleForAssignment(trip)[0] || "Ich";
}

function renameProfileAssignments(previousName, nextName) {
  const from = String(previousName || "").trim();
  const to = String(nextName || "").trim();
  if (!from || !to || from === to) return false;
  let changed = false;

  state.trips.forEach((trip) => {
    if (Array.isArray(trip.people)) {
      const renamedPeople = trip.people.map((person) => {
        const value = String(person || "").trim();
        return value === from || value === "Ich" ? to : person;
      });
      const uniquePeople = Array.from(new Set(renamedPeople.filter(Boolean)));
      if (uniquePeople.join("\u0000") !== trip.people.join("\u0000")) {
        trip.people = uniquePeople;
        changed = true;
      }
    }
    trip.items.forEach((item) => {
      const assignee = String(item.assignee || "").trim();
      if (assignee === from || assignee === "Ich") {
        item.assignee = to;
        changed = true;
      }
    });
  });

  return changed;
}

function assigneeColor(name) {
  const value = displayAssignee(name);
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  }
  return `hsl(${hash} 58% 42%)`;
}

function renderAssigneeFilter() {
  if (!els.assigneeFilter) return;
  const trip = activeTrip();
  const current = els.assigneeFilter.value || "all";
  const people = peopleForAssignment(trip);
  els.assigneeFilter.innerHTML = `<option value="all">Alle Personen</option>${people
    .map((person) => `<option value="${escapeHtml(person)}">${escapeHtml(person)}</option>`)
    .join("")}`;
  els.assigneeFilter.value = people.includes(current) ? current : "all";
  renderAssigneePicker(people);
}

function renderAssigneePicker(people) {
  if (!els.assigneePicker) return;
  const current = els.assigneeFilter.value || "all";
  const options = ["all", ...people];
  els.assigneePicker.innerHTML = options
    .map((person) => {
      const active = person === current;
      const label = person === "all" ? "Alle" : person;
      const style = person === "all" ? "" : ` style="--assignee-color: ${escapeHtml(assigneeColor(person))}"`;
      return `<button class="assignee-chip ${active ? "active" : ""}" data-assignee="${escapeHtml(person)}" type="button" aria-pressed="${active}"${style}><span aria-hidden="true"></span><strong>${escapeHtml(label)}</strong></button>`;
    })
    .join("");
}

function renderCategoryPicker() {
  if (!els.categoryPicker) return;
  const current = els.categoryFilter.value || "all";
  const options = ["all", ...categories];
  els.categoryPicker.innerHTML = options
    .map((category) => {
      const active = category === current;
      const label = category === "all" ? "Alle" : category;
      return `
        <button class="category-chip ${active ? "active" : ""}" data-category="${escapeHtml(category)}" type="button" aria-pressed="${active}">
          <span aria-hidden="true"></span>
          ${escapeHtml(label)}
        </button>
      `;
    })
    .join("");
}

function renderStats(trip) {
  const total = trip.items.length;
  const packed = trip.items.filter((item) => item.packed).length;
  const open = trip.items.filter((item) => !item.packed).length;
  const shopping = trip.items.filter((item) => item.shopping && !item.bought).length;
  els.stats.innerHTML = [
    stat("Gepackt", `${packed}/${total}`),
    stat("Offen", open),
    stat("Einkauf", shopping),
    stat("Personen", trip.people.length)
  ].join("");
}

function stat(label, value) {
  return `<div class="stat"><strong>${value}</strong><span class="muted">${label}</span></div>`;
}

function renderPackProgress(trip) {
  if (!els.packProgress || !els.packProgressText || !els.packProgressBar) return;
  const total = trip.items.length;
  const packed = trip.items.filter((item) => item.packed).length;
  const percent = total ? Math.round((packed / total) * 100) : 0;
  updatePackEmptyTripLink(trip);
  els.packProgress.hidden = total === 0;
  els.packProgressText.textContent = `${packed}/${total}`;
  els.packProgressBar.style.width = `${percent}%`;
}

function filteredTripItems(trip) {
  const query = els.searchInput.value.trim().toLowerCase();
  const category = els.categoryFilter.value;
  const assignee = els.assigneeFilter.value || "all";
  const status = els.statusFilter.value;
  return trip.items.filter((item) => {
    const matchesQuery = !query || item.name.toLowerCase().includes(query);
    const matchesCategory = category === "all" || item.category === category;
    const matchesAssignee = assignee === "all" || item.assignee === sharedAssigneeValue || displayAssignee(item.assignee) === assignee;
    const matchesStatus =
      status === "all" ||
      (status === "missing" && !item.packed) ||
      (status === "packed" && item.packed) ||
      (status === "shopping" && item.shopping && !item.bought);
    return matchesQuery && matchesCategory && matchesAssignee && matchesStatus;
  });
}

function estimateCategory(name) {
  const value = name.toLowerCase();
  const remembered = (state.globalItems || []).find((item) => normalizeTemplateName(item.name) === normalizeTemplateName(name));
  if (remembered?.category && categories.includes(remembered.category)) return { category: remembered.category, confident: true };
  const rules = [
    ["Dokumente", ["pass", "ausweis", "ticket", "buchung", "visum", "führerschein", "versicherung", "beleg", "karte"]],
    ["Technik", ["lade", "kabel", "akku", "powerbank", "laptop", "tablet", "kamera", "kopfhörer", "adapter", "handy"]],
    ["Hygiene", ["zah", "shampoo", "dusch", "creme", "sonnencreme", "deo", "rasierer", "handtuch", "bürste"]],
    ["Medizin", ["medik", "tablette", "pflaster", "apotheke", "mücken", "schmerz", "allergie"]],
    ["Nahrung", ["essen", "snack", "brot", "wasser", "trink", "flasche", "kaffee", "tee", "müsli", "riegel", "obst", "gemüse", "milch", "nudel", "reis", "konserve", "gewürz"]],
    ["Kleidung", ["hose", "shirt", "sock", "schuh", "jacke", "pulli", "kleid", "mütze", "handschuh", "wäsche"]],
    ["Freizeit", ["buch", "spiel", "zelt", "schlafsack", "ball", "brille", "tasche"]]
  ];
  const match = rules.find(([, words]) => words.some((word) => value.includes(word)));
  return match ? { category: match[0], confident: true } : { category: "Freizeit", confident: false };
}

function rememberItemCategory(name, category) {
  if (!canEditLists()) return;
  const cleanName = String(name || "").trim();
  if (!cleanName || !categories.includes(category)) return;
  state.globalItems ||= [];
  const key = normalizeTemplateName(cleanName);
  const existing = state.globalItems.find((item) => normalizeTemplateName(item.name) === key);
  if (existing) {
    existing.category = category;
    return;
  }
  state.globalItems.push({ id: crypto.randomUUID(), name: cleanName, category });
}

function estimateItemGroup(name, category) {
  const value = String(name || "").toLowerCase();
  if (category === "Kleidung") {
    if (["shirt", "hemd", "pullover", "hoodie", "top", "jacke", "unterw", "bluse"].some((word) => value.includes(word))) return "Oberteile";
    if (["hose", "shorts", "rock", "leggings", "jeans"].some((word) => value.includes(word))) return "Unterteile";
    if (["schuh", "sneaker", "sandale", "sock"].some((word) => value.includes(word))) return "Schuhe";
    if (["mütze", "muetze", "cap", "gürtel", "guertel", "schal", "handschuh", "brille"].some((word) => value.includes(word))) return "Accessoires";
  }
  if (category === "Nahrung") return "Lebensmittel";
  if (category === "Technik") return "Geräte";
  return "Allgemein";
}

function renderTripItems(trip) {
  const previousScrollLeft = els.tripItems.scrollLeft;
  els.tripItems.innerHTML = "";
  els.tripItems.classList.remove("category-carousel");
  const items = filteredTripItems(trip);
  if (!items.length) {
    shouldFocusPackSlide = false;
    updatePackSliderStatus();
    els.tripItems.innerHTML = `<div class="empty-state">Keine passenden Einträge gefunden.</div>`;
    return;
  }
  const grouped = groupBy(items, (item) => item.category || "Sonstiges");
  const groupedEntries = Object.entries(grouped).sort(([a], [b]) => categories.indexOf(a) - categories.indexOf(b));
  const visibleCategories = groupedEntries.map(([category]) => category);
  const activeCategoryStillVisible = visibleCategories.includes(activePackCategory);
  const filteredCategory = categories.includes(els.categoryFilter.value) ? els.categoryFilter.value : "";
  if (!activeCategoryStillVisible) activePackCategory = visibleCategories[0] || "";
  if (filteredCategory) activePackCategory = filteredCategory;
  const shouldMoveToActiveSlide = shouldFocusPackSlide || Boolean(filteredCategory) || !activeCategoryStillVisible;
  els.tripItems.classList.add("category-carousel");
  groupedEntries.forEach(([category, categoryItems]) => {
    const slide = document.createElement("div");
    slide.className = "category-slide";
    slide.dataset.category = category;
    const groupedItems = groupBy(categoryItems, (item) => item.group || estimateItemGroup(item.name, category));
    const groupEntries = Object.entries(groupedItems);
    const showSubgroups = groupEntries.length > 1 || groupEntries.some(([group]) => group !== "Allgemein");
    const itemSections = showSubgroups
      ?
      groupEntries.map(([group, groupItems]) => {
          const section = document.createElement("section");
          section.className = "item-subgroup";
          section.innerHTML = `<h4>${escapeHtml(group)}</h4>`;
          groupItems.forEach((item) => section.append(createItemRow(item, trip)));
          return section;
        })
      : categoryItems.map((item) => createItemRow(item, trip));
    slide.append(
      createAccordionGroup({
        title: category,
        meta: `${categoryItems.length} ${categoryItems.length === 1 ? "Eintrag" : "Einträge"}`,
        open: true,
        lockedOpen: true,
        className: "item-list"
      }, itemSections)
    );
    els.tripItems.append(slide);
  });
  window.setTimeout(() => {
    const activeSlide = Array.from(els.tripItems.querySelectorAll(".category-slide")).find((slide) => slide.dataset.category === activePackCategory);
    if (shouldMoveToActiveSlide) {
      scrollPackSlideHorizontally(activeSlide, "auto");
    } else {
      els.tripItems.scrollLeft = previousScrollLeft;
    }
    shouldFocusPackSlide = false;
    updatePackSliderStatus();
  }, 0);
}

function scrollPackSlideHorizontally(slide, behavior = "smooth") {
  if (!slide || !els.tripItems) return;
  els.tripItems.scrollTo({
    left: slide.offsetLeft,
    top: 0,
    behavior
  });
}

function updatePackSliderStatus() {
  if (!els.packSliderStatus) return;
  const slides = Array.from(els.tripItems.querySelectorAll(".category-slide"));
  if (!slides.length || !els.tripItems.classList.contains("category-carousel")) {
    els.packSliderStatus.hidden = true;
    return;
  }
  const containerLeft = els.tripItems.getBoundingClientRect().left;
  let index = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  slides.forEach((slide, slideIndex) => {
    const distance = Math.abs(slide.getBoundingClientRect().left - containerLeft);
    if (distance < bestDistance) {
      bestDistance = distance;
      index = slideIndex;
    }
  });
  activePackCategory = slides[index].dataset.category || activePackCategory;
  els.packSliderStatus.hidden = slides.length <= 1;
  if (els.packSliderDots) {
    els.packSliderDots.innerHTML = slides
      .map((slide, slideIndex) => `
        <button class="slider-line ${slideIndex === index ? "active" : ""}" data-slide="${slideIndex}" type="button" aria-label="${escapeHtml(slide.dataset.category || `Bereich ${slideIndex + 1}`)}"></button>
      `)
      .join("");
    els.packSliderDots.querySelectorAll(".slider-line").forEach((button) => {
      button.addEventListener("click", () => {
        const target = slides[Number(button.dataset.slide)];
        if (target.dataset.category) activePackCategory = target.dataset.category;
        scrollPackSlideHorizontally(target, "smooth");
      });
    });
  }
}

function createItemRow(item, trip) {
  const row = els.itemTemplate.content.firstElementChild.cloneNode(true);
  const editable = canEditActiveTrip();
  row.classList.toggle("read-only", !editable);
  row.classList.toggle("packed", item.packed);
  decorateAssigneeRow(row, item);
  row.querySelector(".item-name").innerHTML = itemNameHtml(item);
  row.querySelector(".item-details").innerHTML = itemDetailsHtml(item);
  const toggleButton = row.querySelector(".item-toggle");
  const controls = row.querySelector(".item-controls");
  let swipeHandled = false;
  toggleButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (swipeHandled) return;
    if (!editable) {
      setCloudStatus("Melde dich an, um Einträge zu bearbeiten.", "local");
      return;
    }
    const isOpen = toggleButton.getAttribute("aria-expanded") === "true";
    if (isOpen) {
      openItemSettingsDialog(item);
      return;
    }
    closeExpandedItems();
    toggleButton.setAttribute("aria-expanded", "true");
    controls.hidden = false;
    row.classList.add("expanded");
  });

  const packButton = row.querySelector(".pack-button");
  packButton.textContent = "Gepackt";
  packButton.classList.toggle("active", item.packed);
  packButton.setAttribute("aria-pressed", String(item.packed));
  packButton.disabled = !editable;
  packButton.addEventListener("click", () => updateItem(item.id, { packed: !item.packed }, `${item.name} abgehakt`));

  const buyButton = row.querySelector(".buy-button");
  buyButton.classList.toggle("active", item.shopping);
  buyButton.setAttribute("aria-pressed", String(item.shopping));
  buyButton.disabled = !editable;
  buyButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleButton.setAttribute("aria-expanded", "false");
    controls.hidden = true;
    row.classList.remove("expanded");
    updateItem(item.id, { shopping: !item.shopping }, `${item.name} für Einkauf aktualisiert`);
  });

  let swipeStart = null;
  row.addEventListener("pointerdown", (event) => {
    if (!editable || !event.isPrimary || event.button !== 0) return;
    if (event.target.closest(".pack-button, .buy-button, input, select, textarea, a")) return;
    event.stopPropagation();
    swipeStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, time: Date.now() };
    row.setPointerCapture?.(event.pointerId);
  });
  row.addEventListener("pointerup", (event) => {
    if (!swipeStart || event.pointerId !== swipeStart.pointerId) return;
    const deltaX = event.clientX - swipeStart.x;
    const deltaY = event.clientY - swipeStart.y;
    const elapsed = Date.now() - swipeStart.time;
    swipeStart = null;
    if (elapsed > 700 || deltaX > -72 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;
    swipeHandled = true;
    window.setTimeout(() => { swipeHandled = false; }, 0);
    if (item.shopping) {
      setCloudStatus(`${item.name} steht schon auf der Einkaufsliste.`, "online");
      return;
    }
    updateItem(item.id, { shopping: true, bought: false }, `${item.name} zur Einkaufsliste hinzugefügt`);
  });
  row.addEventListener("pointercancel", () => {
    swipeStart = null;
  });

  return row;
}

function createShoppingRow(item) {
  const editable = canEditLists();
  const row = document.createElement("article");
  row.className = "item-row shopping-item-row";
  row.classList.toggle("read-only", !editable);
  row.classList.toggle("bought", Boolean(item.bought));
  decorateAssigneeRow(row, item);
  row.innerHTML = `
    <div class="item-row-head">
      <button class="item-toggle" type="button" aria-expanded="false">
        <span>
          <strong class="item-name">${itemNameHtml(item)}</strong>
          <span class="item-details">${itemDetailsHtml(item)}</span>
        </span>
      </button>
      <button class="shopping-done-button ${item.bought ? "active" : ""}" type="button" aria-pressed="${String(Boolean(item.bought))}">${item.bought ? "Offen" : "Gekauft"}</button>
    </div>
    <div class="item-controls" hidden>
      <div class="shopping-row-actions">
        <button class="shopping-remove-button" type="button">Von Einkauf entfernen</button>
      </div>
    </div>
  `;
  const toggleButton = row.querySelector(".item-toggle");
  const controls = row.querySelector(".item-controls");
  toggleButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!editable) {
      setCloudStatus("Melde dich an, um Einträge zu bearbeiten.", "local");
      return;
    }
    const isOpen = toggleButton.getAttribute("aria-expanded") === "true";
    if (isOpen) {
      openItemSettingsDialog(item);
      return;
    }
    closeExpandedItems();
    toggleButton.setAttribute("aria-expanded", "true");
    controls.hidden = false;
    row.classList.add("expanded");
  });
  row.querySelector(".shopping-done-button").addEventListener("click", (event) => {
    event.stopPropagation();
    if (!requireSignedInForEdit()) return;
    const bought = !item.bought;
    updateItem(item.id, { bought, shopping: true }, bought ? `${item.name} gekauft` : `${item.name} wieder offen`);
  });
  row.querySelector(".shopping-remove-button").addEventListener("click", (event) => {
    event.stopPropagation();
    if (!requireSignedInForEdit()) return;
    toggleButton.setAttribute("aria-expanded", "false");
    controls.hidden = true;
    row.classList.remove("expanded");
    updateItem(item.id, { shopping: false, bought: false }, `${item.name} von der Einkaufsliste entfernt`);
  });
  row.querySelectorAll(".shopping-done-button, .shopping-remove-button").forEach((button) => {
    button.disabled = !editable;
  });
  return row;
}

function itemDetailsHtml(item) {
  return "";
}

function itemNameHtml(item) {
  return `<span class="item-title-text">${escapeHtml(item.name)}</span>${item.quantity ? `<span class="quantity-inline">${escapeHtml(item.quantity)}</span>` : ""}<span class="assignee-inline">${escapeHtml(displayAssignee(item.assignee))}</span>`;
}

function decorateAssigneeRow(row, item) {
  const assignee = displayAssignee(item.assignee);
  row.classList.add("has-assignee");
  row.style.setProperty("--assignee-color", assigneeColor(assignee));
  row.dataset.assignee = assignee;
}

function closeExpandedItems(exceptRow = null) {
  document.querySelectorAll(".item-row.expanded").forEach((row) => {
    if (row === exceptRow) return;
    row.classList.remove("expanded");
    const toggle = row.querySelector(".item-toggle");
    const controls = row.querySelector(".item-controls");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    if (controls) controls.hidden = true;
  });
}

function updateItem(id, patch, activity) {
  if (!requireSignedInForEdit()) return;
  const trip = activeTrip();
  const item = trip.items.find((entry) => entry.id === id);
  if (!item) return;
  Object.assign(item, patch);
  addActivity(activity);
  commit();
}

function renderGlobalItems(trip) {
  els.globalItems.innerHTML = "";
  const missingCount = countMissingTemplates(trip);
  els.addMissingTemplatesButton.disabled = !canEditLists() || missingCount === 0;
  els.addMissingTemplatesButton.textContent = missingCount ?
     `${missingCount} ${missingCount === 1 ? "Vorlage" : "Vorlagen"} übernehmen`
    : "Alle Vorlagen übernommen";
  const grouped = groupBy(state.globalItems, (item) => item.category || "Sonstiges");
  Object.entries(grouped).forEach(([category, globalItems], index) => {
    const cards = globalItems.map((globalItem) => {
      const exists = trip.items.some((item) => item.name === globalItem.name);
      const article = document.createElement("article");
      article.className = "global-item";
      article.innerHTML = `
        <span class="category-pill">${escapeHtml(globalItem.category)}</span>
        <strong>${escapeHtml(globalItem.name)}</strong>
        <button type="button">${exists ? "Schon in Liste" : "In Reise übernehmen"}</button>
      `;
      article.querySelector("button").disabled = !canEditLists() || exists;
      article.querySelector("button").addEventListener("click", () => {
        if (!requireSignedInForEdit()) return;
        trip.items.push(makeItem(globalItem.name, globalItem.category, defaultAssignee(trip)));
        addActivity(`${globalItem.name} aus globaler Liste übernommen`);
        commit();
      });
      return article;
    });
    els.globalItems.append(
      createAccordionGroup({
        title: category,
        meta: `${globalItems.length} Vorlagen`,
        open: false,
        className: "global-grid"
      }, cards)
    );
  });
}

function renderCustomTemplates(trip) {
  els.customTemplates.innerHTML = "";
  const templates = state.customTemplates || [];
  if (els.templateCountLabel) {
    els.templateCountLabel.textContent = `${templates.length} ${templates.length === 1 ? "Vorlage" : "Vorlagen"}`;
  }
  if (!templates.length) {
    els.customTemplates.innerHTML = `
      <div class="empty-state">
        Noch keine eigenen Vorlagen. Speichere eine fertige Reise als Vorlage und nutze sie später direkt über das Plus in der Packliste.
      </div>
    `;
    return;
  }

  const query = (els.templateSearchInput.value || "").trim().toLowerCase();
  const visibleTemplates = templates.filter((template) => {
    if (!query) return true;
    const haystack = `${template.name} ${template.items.map((item) => `${item.name} ${item.category || ""}`).join(" ")}`.toLowerCase();
    return haystack.includes(query);
  });
  if (!visibleTemplates.length) {
    els.customTemplates.innerHTML = `<div class="empty-state">Keine Vorlage passt zu deiner Suche.</div>`;
    return;
  }

  visibleTemplates.forEach((template) => {
    const card = document.createElement("article");
    card.className = "template-card";
    const categoriesInTemplate = Array.from(new Set(template.items.map((item) => item.category).filter(Boolean)));
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(template.name)}</strong>
        <span>${template.items.length} ${template.items.length === 1 ? "Gegenstand" : "Gegenstände"} · ${categoriesInTemplate.length || 1} ${categoriesInTemplate.length === 1 ? "Kategorie" : "Kategorien"}</span>
      </div>
      <div class="template-preview">
        ${template.items.slice(0, 5).map((item) => `<span>${escapeHtml(item.name)}</span>`).join("")}
        ${template.items.length > 5 ? `<span>+${template.items.length - 5}</span>` : ""}
      </div>
      <div class="template-card-actions">
        <button class="apply-template-button" type="button">Übernehmen</button>
        <button class="secondary-danger delete-template-button" type="button">Entfernen</button>
      </div>
    `;
    card.querySelector(".apply-template-button").addEventListener("click", () => applyCustomTemplateToActiveTrip(template.id));
    card.querySelector(".delete-template-button").addEventListener("click", () => deleteCustomTemplate(template.id));
    els.customTemplates.append(card);
  });
}

function saveActiveTripAsTemplate() {
  if (!requireSignedInForEdit()) return;
  const trip = activeTrip();
  const name = els.newTemplateNameInput.value.trim() || `${trip.name} Vorlage`;
  const items = trip.items.map((item) => ({
    name: item.name,
    category: item.category,
    quantity: item.quantity || "",
    note: item.note || "",
    group: item.group || "",
    shopping: Boolean(item.shopping)
  }));
  if (!items.length) {
    setCloudStatus("Die aktive Reise hat noch keine Gegenstände für eine Vorlage.", currentUser ? "online" : "local");
    return;
  }
  state.customTemplates ||= [];
  state.customTemplates.unshift({
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    items
  });
  els.newTemplateNameInput.value = "";
  addActivity(`${name} als eigene Vorlage gespeichert`);
  commit();
}

function applyCustomTemplateToActiveTrip(templateId) {
  if (!requireSignedInForEdit()) return;
  const template = (state.customTemplates || []).find((entry) => entry.id === templateId);
  if (!template) return;
  const trip = activeTrip();
  const existingNames = new Set(trip.items.map((item) => item.name.trim().toLowerCase()));
  const newItems = template.items.filter((item) => !existingNames.has(item.name.trim().toLowerCase()));
  newItems.forEach((item) => {
    trip.items.push(makeItem(item.name, item.category, defaultAssignee(trip), {
      shopping: Boolean(item.shopping),
      quantity: item.quantity || "",
      note: item.note || ""
    }));
  });
  addActivity(`${newItems.length} Gegenstände aus Vorlage ${template.name} übernommen`);
  commit();
}

function deleteCustomTemplate(templateId) {
  if (!requireSignedInForEdit()) return;
  const template = (state.customTemplates || []).find((entry) => entry.id === templateId);
  if (!template) return;
  const confirmed = window.confirm(`Vorlage "${template.name}" wirklich löschen`);
  if (!confirmed) return;
  state.customTemplates = state.customTemplates.filter((entry) => entry.id !== templateId);
  addActivity(`${template.name}-Vorlage gelöscht`);
  commit();
}

function renderTripOverview(trip) {
  if (!els.tripOverviewPanel || !trip) return;
  const placeholder = isPlaceholderTrip(trip);
  const total = trip.items.length;
  const packed = trip.items.filter((item) => item.packed).length;
  const shoppingOpen = trip.items.filter((item) => item.shopping && !item.bought).length;
  const duration = calculateTripDuration(trip.startDate, trip.endDate);
  const dishCount = trip.meals.length || 0;
  const progressValue = total ? Math.round((packed / total) * 100) : 0;
  const durationText = duration && !duration.invalid
    ? `${duration.days} ${duration.days === 1 ? "Tag" : "Tage"} · ${duration.nights} ${duration.nights === 1 ? "Nacht" : "Nächte"}`
    : "Zeitraum offen";

  const editable = canEditLists() && !placeholder;
  const overviewIcon = tripIcon(trip);
  const friends = (trip.people || []).map(displayAssignee).filter((person) => person && !isOwnPersonName(person));
  const friendText = friends.length ? friends.join(", ") : "Lade Freunde ein und teile die Packliste.";
  els.tripOverviewPanel.innerHTML = `
    <button class="trip-overview-main trip-overview-clickable" id="activeTripOverviewButton" type="button" aria-label="${placeholder ? "Reise anlegen" : "Aktive Reise wechseln"}">
      <div>
        <p class="eyebrow">${placeholder ? "Noch keine Reise" : "Aktive Reise"}</p>
        <h3>${placeholder ? "Erste Reise anlegen" : escapeHtml(trip.name)}</h3>
        <p class="muted">${placeholder ? "Lege zuerst eine Reise an, bevor du sie bearbeitest." : `${escapeHtml(displayTripDates(trip))} · ${escapeHtml(durationText)}`}</p>
      </div>
      ${overviewIcon ? `<span class="trip-overview-mark" aria-hidden="true">${escapeHtml(overviewIcon)}</span>` : ""}
    </button>
    <div class="trip-overview-progress" aria-label="Packfortschritt ${progressValue}%">
      <span style="width:${progressValue}%"></span>
    </div>
    <button class="trip-overview-invite trip-team-panel trip-friends-trigger" id="overviewFriendsButton" type="button" aria-label="Freunde für diese Reise auswählen" ${editable ? "" : "disabled"}>
      <div>
        <p class="eyebrow">Gemeinsam packen</p>
        <strong>${friends.length ? `${friends.length} ${friends.length === 1 ? "Freund dabei" : "Freunde dabei"}` : "Freunde einladen"}</strong>
        <span>${escapeHtml(friendText)}</span>
      </div>
    </button>
  `;
  els.tripOverviewPanel.querySelector("#activeTripOverviewButton").addEventListener("click", placeholder ? openNewTripDialog : openTripPicker);
  els.tripOverviewPanel.querySelector("#overviewFriendsButton").addEventListener("click", () => {
    if (!requireSignedInForEdit()) return;
    openTripFriendsDialog(trip.id);
  });
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function renderManageTrips() {
  els.tripManageList.innerHTML = "";
  if (els.tripManageFold) els.tripManageFold.hidden = true;
}

function openManageTripDialog(tripId = state.activeTripId) {
  if (!requireSignedInForEdit()) return;
  const trip = state.trips.find((entry) => entry.id === tripId) || activeTrip();
  if (isPlaceholderTrip(trip)) {
    openNewTripDialog();
    return;
  }
  editingManageTripId = trip.id;
  els.manageDialogTripIcon.innerHTML = tripIconChoices.map((choice) => `<option value="${escapeHtml(choice)}">${escapeHtml(choice || "Kein Icon")}</option>`).join("");
  els.manageDialogTripIcon.value = trip.icon || "";
  els.manageDialogTripName.value = trip.name;
  els.manageDialogTripDestination.value = trip.destination || "";
  els.manageDialogTripStart.value = trip.startDate || "";
  els.manageDialogTripEnd.value = trip.endDate || "";
  if (els.manageDialogTripDurationDays) els.manageDialogTripDurationDays.value = tripDurationDaysFromDates(trip.startDate, trip.endDate);
  if (els.manageDialogTripTravelMethod) els.manageDialogTripTravelMethod.value = trip.travelMethod || "";
  setTravelMethod("manage", trip.travelMethod || "");
  manageTripActivities = [...(trip.activities || [])];
  if (els.manageDialogTripActivityInput) els.manageDialogTripActivityInput.value = "";
  renderActivityChips(els.manageDialogTripActivityList, manageTripActivities);
  setManageTripSmartContext(trip.smartContext);
  updateManageDialogDuration();
  if (els.manageDialogTripFriendInput) els.manageDialogTripFriendInput.value = "";
  if (els.manageDialogTripFriendsList) els.manageDialogTripFriendsList.dataset.selectedFriendIds = (trip.friendIds || []).join(",");
  renderTripFriendPicker(els.manageDialogTripFriendsList, trip.people || []);
  els.manageDialogCompleteButton.textContent = trip.completed ? "Wieder öffnen" : "Abschließen";
  els.manageTripDialog.hidden = false;
  window.setTimeout(() => els.manageDialogTripName.focus(), 0);
}

function closeManageTripDialog() {
  window.clearTimeout(manageTripAutosaveTimer);
  els.manageTripDialog.hidden = true;
  editingManageTripId = null;
}

function openTripFriendsDialog(tripId = state.activeTripId) {
  if (!requireSignedInForEdit()) return;
  const trip = state.trips.find((entry) => entry.id === tripId) || activeTrip();
  if (isPlaceholderTrip(trip)) {
    openNewTripDialog();
    return;
  }
  editingTripFriendsId = trip.id;
  if (els.tripFriendsDialogTitle) els.tripFriendsDialogTitle.textContent = `Freunde für ${trip.name}`;
  if (els.tripFriendsList) els.tripFriendsList.dataset.selectedFriendIds = (trip.friendIds || []).join(",");
  renderTripFriendPicker(els.tripFriendsList, trip.people || []);
  els.tripFriendsDialog.hidden = false;
  window.setTimeout(() => els.tripFriendsList?.querySelector("[data-trip-friend]")?.focus(), 0);
}

function closeTripFriendsDialog() {
  if (els.tripFriendsDialog) els.tripFriendsDialog.hidden = true;
  editingTripFriendsId = null;
}

function saveTripFriendsDialog(options = {}) {
  if (!requireSignedInForEdit()) return;
  const trip = state.trips.find((entry) => entry.id === editingTripFriendsId);
  if (!trip) return;
  trip.people = tripPeopleFromSelectedFriends(selectedFriendsFromPicker(els.tripFriendsList), trip);
  trip.friendIds = selectedFriendIdsFromPicker(els.tripFriendsList);
  if (options.close) closeTripFriendsDialog();
  commit();
  setCloudStatus("Freunde gespeichert.", currentUser ? "online" : "local");
}

function updateManageDialogDuration() {
  const endDate = calculateTripEndDate(els.manageDialogTripStart.value, els.manageDialogTripDurationDays.value);
  els.manageDialogTripEnd.value = endDate;
  els.manageDialogTripDuration.textContent = tripDurationLabel(els.manageDialogTripStart.value, endDate);
  if (els.manageDialogTripEndPreview) {
    els.manageDialogTripEndPreview.textContent = endDate ?
       `Abreise: ${formatDateInput(endDate)}`
      : "";
    els.manageDialogTripEndPreview.hidden = !endDate;
  }
}

function saveManageTripDialog(options = {}) {
  if (!requireSignedInForEdit()) return;
  const shouldClose = options.close !== false;
  const trip = state.trips.find((entry) => entry.id === editingManageTripId);
  if (!trip) return;
  trip.icon = sanitizeTripIcon(els.manageDialogTripIcon.value);
  trip.name = els.manageDialogTripName.value.trim() || "Unbenannte Reise";
  trip.destination = els.manageDialogTripDestination.value.trim();
  trip.startDate = els.manageDialogTripStart.value;
  trip.endDate = els.manageDialogTripEnd.value;
  trip.dates = formatTripDateRange(trip.startDate, trip.endDate);
  trip.travelMethod = els.manageDialogTripTravelMethod.value || "";
  trip.activities = [...manageTripActivities];
  trip.smartContext = readManageTripSmartContext();
  trip.people = tripPeopleFromSelectedFriends(selectedFriendsFromPicker(els.manageDialogTripFriendsList), trip);
  trip.friendIds = selectedFriendIdsFromPicker(els.manageDialogTripFriendsList);
  if (shouldClose) addActivityToTrip(trip, "Reise bearbeitet");
  if (shouldClose) closeManageTripDialog();
  commit();
  if (!shouldClose) setCloudStatus("Reise automatisch gespeichert.", currentUser ? "online" : "local");
}

function scheduleManageTripAutosave() {
  if (!editingManageTripId || !canEditLists()) return;
  window.clearTimeout(manageTripAutosaveTimer);
  manageTripAutosaveTimer = window.setTimeout(() => saveManageTripDialog({ close: false }), 450);
}

function renderTripTimeline() {
  els.tripTimeline.innerHTML = "";
  sortedTripsForTimeline().forEach((trip) => {
    const total = trip.items.length;
    const packed = trip.items.filter((item) => item.packed).length;
    const icon = tripIcon(trip);
    const planMeta = tripPlanMeta(trip);
    const item = document.createElement("button");
    item.className = `timeline-item ${trip.id === state.activeTripId ? "active" : ""}`;
    item.type = "button";
    item.innerHTML = `
      <span class="timeline-dot" aria-hidden="true"></span>
      <span class="timeline-body">
        <strong>${icon ? `<span class="trip-icon" aria-hidden="true">${escapeHtml(icon)}</span>` : ""}${escapeHtml(trip.name)}</strong>
        <span>${escapeHtml(displayTripDates(trip))}</span>
        <small>${trip.completed ? "Abgeschlossen" : "Offen"} · ${packed}/${total} gepackt${planMeta ? ` · ${escapeHtml(planMeta)}` : ""}</small>
      </span>
    `;
    item.addEventListener("click", () => {
      if (!requireSignedInForEdit()) return;
      state.activeTripId = trip.id;
      commit();
      openTripSettings(trip.id);
    });
    els.tripTimeline.append(item);
  });
}

function openTripSettings(tripId) {
  activateView("manage");
  if (els.tripManageFold) els.tripManageFold.open = true;
  window.setTimeout(() => {
    document.querySelector(`[data-trip-id="${tripId}"]`).scrollIntoView({ behavior: "smooth", block: "center" });
  }, 0);
}

function sortedTripsForTimeline() {
  return actualTrips().slice().sort((a, b) => {
    if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

function renderWeatherPanel(trip) {
  if (!els.weatherStatus || !els.weatherSummary || !els.weatherSuggestions || !els.addWeatherItemsButton) return;
  const cached = weatherCache.get(trip.id);
  const place = trip.destination || "";
  if (!place) {
    els.weatherStatus.textContent = "Trage bei der Reise einen Ort für Wetter ein, dann können Wettervorschläge erstellt werden.";
    els.weatherSummary.hidden = true;
    if (els.weatherDays) els.weatherDays.hidden = true;
    els.weatherSuggestions.hidden = true;
    els.addWeatherItemsButton.hidden = true;
    return;
    els.weatherStatus.textContent = "Trage bei der Reise ein Ziel ein, dann können Wettervorschläge erstellt werden.";
    els.weatherSummary.hidden = true;
    els.weatherSuggestions.hidden = true;
    els.addWeatherItemsButton.hidden = true;
    return;
  }
  if (!cached) {
    if (els.weatherDays) els.weatherDays.hidden = true;
    els.weatherStatus.textContent = `Bereit für Wettervorschläge zu ${place}.`;
    els.weatherSummary.hidden = true;
    els.weatherSuggestions.hidden = true;
    els.addWeatherItemsButton.hidden = true;
    return;
  }
  els.weatherStatus.textContent = cached.forecastNotice ? `${cached.location} · ${cached.forecastNotice}` : cached.location;
  els.weatherSummary.hidden = false;
  els.weatherSummary.innerHTML = `
    <span><strong>${cached.minTemp}° bis ${cached.maxTemp}°</strong><small>Temperatur</small></span>
    <span><strong>${cached.rain} mm</strong><small>Regen</small></span>
    <span><strong>${cached.wind} km/h</strong><small>Wind</small></span>
  `;
  if (els.weatherDays) {
    els.weatherDays.hidden = !cached.days.length;
    els.weatherDays.innerHTML = (cached.days || [])
      .map((day) => `<span><strong>${escapeHtml(day.label)}</strong><small>${escapeHtml(day.weather)} · ${escapeHtml(day.minTemp)}° bis ${escapeHtml(day.maxTemp)}° · ${escapeHtml(day.rain)} mm</small></span>`)
      .join("");
  }
  els.weatherSuggestions.hidden = !cached.suggestions.length;
  els.weatherSuggestions.innerHTML = cached.suggestions.length ?
     cached.suggestions.map((item) => `<span>${escapeHtml(item.name)}</span>`).join("")
    : `<span>Keine zusätzlichen Wettergegenstände nötig.</span>`;
  els.addWeatherItemsButton.hidden = cached.suggestions.length === 0;
}

function shouldRefreshWeather(trip) {
  if (!trip.destination || !navigator.onLine || weatherAutoRefreshInFlight) return false;
  const cached = weatherCache.get(trip.id);
  if (!cached?.fetchedAt) return true;
  return Date.now() - cached.fetchedAt > 60 * 60 * 1000;
}

function maybeAutoRefreshWeather(viewName = currentView) {
  if (!["calendar", "food", "manage"].includes(viewName)) return;
  const trip = activeTrip();
  if (!shouldRefreshWeather(trip)) return;
  weatherAutoRefreshInFlight = true;
  loadWeatherForActiveTrip({ silent: true })
    .then(() => renderMealsCompact(activeTrip()))
    .catch(() => {})
    .finally(() => {
      weatherAutoRefreshInFlight = false;
    });
}

function weatherCodeLabel(code) {
  if ([0, 1].includes(code)) return "sonnig";
  if ([2, 3].includes(code)) return "bewölkt";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "regnerisch";
  if (code >= 71 && code <= 86) return "winterlich";
  if (code >= 95) return "Gewitter möglich";
  return "wechselhaft";
}

function weatherDisplay(code) {
  const value = Number(code);
  if ([0, 1].includes(value)) return { icon: "☀", label: "sonnig" };
  if ([2, 3].includes(value)) return { icon: "☁", label: "bewölkt" };
  if ([45, 48].includes(value)) return { icon: "≋", label: "neblig" };
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(value)) return { icon: "☂", label: "Regen" };
  if ([71, 73, 75, 77, 85, 86].includes(value)) return { icon: "❄", label: "Schnee" };
  if ([95, 96, 99].includes(value)) return { icon: "⚡", label: "Gewitter" };
  return { icon: "☁", label: "wechselhaft" };
}

function weatherSuggestionsFromForecast({ minTemp, maxTemp, rain, wind, codes }) {
  const suggestions = [];
  const add = (name, category, quantity = "") => {
    if (!suggestions.some((item) => item.name === name)) suggestions.push({ name, category, quantity });
  };
  const rainy = rain >= 2 || codes.some((code) => (code >= 51 && code <= 67) || (code >= 80 && code <= 82));
  const snowy = codes.some((code) => code >= 71 && code <= 86);
  if (rainy) {
    add("Regenjacke", "Kleidung");
    add("Regenschirm", "Freizeit");
  }
  if (maxTemp >= 24) {
    add("Sonnencreme", "Hygiene");
    add("Kopfbedeckung", "Kleidung");
    add("Trinkflasche", "Nahrung");
  }
  if (minTemp <= 8) {
    add("Warme Jacke", "Kleidung");
    add("Mütze", "Kleidung");
  }
  if (wind >= 35) add("Windjacke", "Kleidung");
  if (snowy) {
    add("Handschuhe", "Kleidung");
    add("Thermounterwäsche", "Kleidung");
  }
  return suggestions;
}

function weatherWindowForTrip(trip, daily) {
  const times = daily.time || [];
  const availableDays = times.map((date, index) => ({ date, index }));
  if (!availableDays.length) return [];
  const travelDates = tripMealDays(trip);
  if (!travelDates.length) return availableDays.slice(0, 7);
  const lastAvailable = availableDays[availableDays.length - 1];
  return travelDates.map((date) => {
    const exact = availableDays.find((day) => day.date === date);
    return exact || {
      date,
      index: lastAvailable.index,
      estimated: true,
      sourceDate: lastAvailable.date
    };
  });
}

function buildWeatherDayRows(days, daily) {
  return days.map(({ date, index, estimated = false, sourceDate = "" }) => ({
    date,
    label: formatDateInput(date),
    estimated: Boolean(estimated),
    sourceDate: sourceDate || date,
    code: (daily.weather_code || [])[index] || 0,
    weather: weatherCodeLabel((daily.weather_code || [])[index] || 0),
    minTemp: Math.round(Number((daily.temperature_2m_min || [])[index] ?? 0)),
    maxTemp: Math.round(Number((daily.temperature_2m_max || [])[index] ?? 0)),
    rain: Math.round(Number((daily.precipitation_sum || [])[index] ?? 0) * 10) / 10,
    wind: Math.round(Number((daily.wind_speed_10m_max || [])[index] ?? 0))
  }));
}

async function loadWeatherForActiveTrip(options = {}) {
  const silent = Boolean(options.silent);
  const trip = activeTrip();
  const place = trip.destination || "";
  if (!place) {
    setCloudStatus("Bitte zuerst den Ort für Wetter eintragen.", "error");
    renderWeatherPanel(trip);
    return;
  }
  els.loadWeatherButton.disabled = true;
  els.loadWeatherButton.textContent = "Prüfe...";
  try {
    const geoResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=de&format=json`);
    const geoData = await geoResponse.json();
    const location = geoData.results?.[0];
    if (!location) throw new Error("Reiseziel nicht gefunden.");
    const forecastResponse = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto&forecast_days=16`);
    const forecast = await forecastResponse.json();
    const daily = forecast.daily || {};
    const weatherDays = weatherWindowForTrip(trip, daily);
    const dayRows = buildWeatherDayRows(weatherDays, daily);
    if (!dayRows.length) throw new Error("Keine Wettertage gefunden.");
    const minTemp = Math.round(Math.min(...dayRows.map((day) => day.minTemp)));
    const maxTemp = Math.round(Math.max(...dayRows.map((day) => day.maxTemp)));
    const rain = Math.round(dayRows.reduce((sum, day) => sum + Number(day.rain || 0), 0) * 10) / 10;
    const wind = Math.round(Math.max(...dayRows.map((day) => day.wind)));
    const codes = weatherDays.map((day) => (daily.weather_code || [])[day.index] || 0);
    const mainWeather = weatherCodeLabel(codes[0] || 0);
    const suggestions = weatherSuggestionsFromForecast({ minTemp, maxTemp, rain, wind, codes });
    const estimatedRows = dayRows.filter((day) => day.estimated);
    const forecastNotice = estimatedRows.length ?
       `${estimatedRows.length} spätere Tage nutzen die letzte verfügbare Prognose vom ${formatDateInput(estimatedRows[0].sourceDate)}.`
      : "";
    const usesTripWindow = Boolean(trip.startDate && trip.endDate && weatherDays.some((day) => day.date >= trip.startDate && day.date <= trip.endDate));
    const locationLabel = `${location.name}${location.country ? `, ${location.country}` : ""} · ${dayRows.length} Tage ausgewertet${usesTripWindow ? "" : " (nächste verfügbare Tage)"} · ${mainWeather}`;
    weatherCache.set(trip.id, {
      location: `${location.name}${location.country ? `, ${location.country}` : ""} · ${mainWeather}`,
      minTemp,
      maxTemp,
      rain,
      wind,
      location: locationLabel,
      days: dayRows,
      suggestions,
      forecastNotice,
      fetchedAt: Date.now()
    });
    renderWeatherPanel(trip);
    setCloudStatus("Wettervorschläge geladen.", currentUser ? "online" : "local");
  } catch (error) {
    setCloudStatus(error.message || "Wetter konnte nicht geladen werden.", "error");
  } finally {
    els.loadWeatherButton.disabled = false;
    if (els.foodWeatherButton) {
      els.foodWeatherButton.disabled = false;
      els.foodWeatherButton.innerHTML = `<span aria-hidden="true">☁</span>Wetter`;
    }
    els.loadWeatherButton.textContent = "Wetter prüfen";
  }
}

function addWeatherSuggestionsToTrip() {
  if (!requireSignedInForEdit()) return;
  const trip = activeTrip();
  const cached = weatherCache.get(trip.id);
  if (!cached.suggestions.length) return;
  const existingNames = new Set(trip.items.map((item) => item.name.trim().toLowerCase()));
  const newItems = cached.suggestions.filter((item) => !existingNames.has(item.name.trim().toLowerCase()));
  newItems.forEach((item) => {
    trip.items.push(makeItem(item.name, item.category, defaultAssignee(trip), {
      quantity: item.quantity || "",
      group: estimateItemGroup(item.name, item.category)
    }));
  });
  addActivityToTrip(trip, `${newItems.length} Wettervorschläge übernommen`);
  commit();
  setCloudStatus(newItems.length ? `${newItems.length} Wettervorschläge übernommen.` : "Alle Wettervorschläge sind schon in der Packliste.", currentUser ? "online" : "local");
}

function countMissingTemplates(trip) {
  const existingNames = new Set(trip.items.map((item) => item.name.trim().toLowerCase()));
  return state.globalItems.filter((item) => !existingNames.has(item.name.trim().toLowerCase())).length;
}

function addMissingTemplatesToTrip() {
  if (!requireEditableActiveTrip()) return;
  const trip = activeTrip();
  const existingNames = new Set(trip.items.map((item) => item.name.trim().toLowerCase()));
  const missingTemplates = state.globalItems.filter((item) => !existingNames.has(item.name.trim().toLowerCase()));
  if (!missingTemplates.length) return;

  missingTemplates.forEach((template) => {
    trip.items.push(makeItem(template.name, template.category, defaultAssignee(trip)));
  });
  addActivity(`${missingTemplates.length} Vorlagen in die Reise übernommen`);
  commit();
}

function addVacationTypeTemplates() {
  if (!requireSignedInForEdit()) return;
  const preset = vacationTypeTemplates[els.vacationTypeSelect.value];
  if (!preset) return;

  const existingNames = new Set(state.globalItems.map((item) => item.name.trim().toLowerCase()));
  const newTemplates = preset.items
    .filter(([name]) => !existingNames.has(name.trim().toLowerCase()))
    .map(([name, category]) => ({
      id: crypto.randomUUID(),
      name,
      category
    }));

  if (!newTemplates.length) {
    setCloudStatus(`${preset.label} ist bereits in deinen Vorlagen enthalten.`, currentUser ? "online" : "local");
    return;
  }

  state.globalItems.push(...newTemplates);
  addActivity(`${newTemplates.length} ${preset.label}-Vorlagen gespeichert`);
  commit();
  setCloudStatus(`${newTemplates.length} Vorlagen für ${preset.label} ergänzt.`, currentUser ? "online" : "local");
}

function renderShoppingItems(trip) {
  const placeholder = isPlaceholderTrip(trip);
  if (placeholder) {
    renderShoppingList(els.shoppingItems, []);
    renderShoppingList(els.foodShoppingItems, []);
    [els.completeShoppingButton, els.foodCompleteShoppingButton].forEach((button) => {
      if (button) button.hidden = true;
    });
    updateShoppingModeUi();
    return;
  }
  const items = trip.items.filter((item) => item.shopping);
  const query = (els.shoppingSearchInput?.value || "").trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    const matchesMode = shoppingMode === "food" ? isFoodShoppingItem(item) : !isFoodShoppingItem(item);
    const matchesStatus =
      shoppingStatus === "all" ||
      (shoppingStatus === "open" && !item.bought) ||
      (shoppingStatus === "bought" && item.bought);
    const haystack = `${item.name} ${item.category || ""} ${item.quantity || ""} ${item.note || ""}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    return matchesMode && matchesStatus && matchesQuery;
  });
  renderShoppingList(els.shoppingItems, visibleItems);
  renderShoppingList(els.foodShoppingItems, items);
  [els.completeShoppingButton, els.foodCompleteShoppingButton].forEach((button) => {
    if (button) button.hidden = !canEditLists() || !items.length || items.some((item) => !item.bought);
  });
  updateShoppingModeUi();
}

function isFoodShoppingItem(item) {
  return item.category === "Nahrung" || String(item.note || "").toLowerCase().includes("essen");
}

function renderShoppingList(container, items) {
  if (!container) return;
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = `<div class="empty-state">Aktuell steht nichts auf der Einkaufsliste.</div>`;
    return;
  }
  const grouped = groupBy(items, (item) => item.category || "Sonstiges");
  Object.entries(grouped).forEach(([category, categoryItems], index) => {
    const openCount = categoryItems.filter((item) => !item.bought).length;
    container.append(
      createAccordionGroup({
        title: category,
        meta: openCount ? `${openCount} offen` : "Alles gekauft",
        open: true,
        className: "shopping-list"
      }, categoryItems.map((item) => createShoppingRow(item)))
    );
  });
}

function renderMealsCompact(trip) {
  if (!els.mealList) return;
  trip.meals ||= [];
  selectedMealDate = "";
  if (expandedMealId && !trip.meals.some((meal) => meal.id === expandedMealId)) expandedMealId = null;
  if (els.mealCentralActions) els.mealCentralActions.hidden = true;
  els.mealList.innerHTML = "";
  updateMealKindUi();
  const isSnackView = mealKind === "snack";
  if (els.mealListTitle) els.mealListTitle.textContent = isSnackView ? "Snacks" : "Gerichte";
  if (isPlaceholderTrip(trip)) {
    els.mealList.innerHTML = `<div class="empty-state">Lege zuerst eine Reise an, dann kannst du ${isSnackView ? "Snacks" : "Gerichte"} hinzufügen.</div>`;
    return;
  }
  const meals = (trip.meals || []).filter((meal) => (isSnackView ? meal.type === "snack" : meal.type !== "snack"));
  if (!meals.length) {
    els.mealList.innerHTML = `<div class="empty-state">Noch kein ${isSnackView ? "Snack" : "Gericht"} angelegt. Lege ${isSnackView ? "einen Snack" : "ein Gericht"} über das Plus an.</div>`;
    return;
  }
  renderMealBucketCompact(isSnackView ? "Snacks" : "Gerichte", "", meals);
}

function createMealDaySection(date, index, trip) {
  const section = document.createElement("section");
  section.className = "meal-day-card meal-day-current";
  section.innerHTML = `
    <div class="meal-day-head">
      <strong>Tag ${index + 1}</strong>
      <span>${escapeHtml(formatDateInput(date))}</span>
    </div>
  `;
  mealSlots.forEach((slot) => {
    const slotMeals = trip.meals.filter((meal) => (meal.date || "") === date && (meal.slot || "dinner") === slot.id);
    const slotCard = document.createElement("div");
    slotCard.className = "meal-slot-line";
    slotCard.innerHTML = `<h4>${escapeHtml(slot.label)}</h4><div class="meal-name-list"></div>`;
    const list = slotCard.querySelector(".meal-name-list");
    if (!slotMeals.length) {
      const button = document.createElement("button");
      button.className = "meal-empty-slot";
      button.type = "button";
      button.textContent = "Gericht planen";
      button.addEventListener("click", () => openMealDialog(null, { date, slot: slot.id }));
      list.append(button);
    } else {
      slotMeals.forEach((meal) => list.append(createMealCardCompact(meal, trip)));
    }
    section.append(slotCard);
  });
  return section;
}

function updateSelectedMealDayFromScroll(carousel, days) {
  window.clearTimeout(mealDayScrollTimer);
  mealDayScrollTimer = window.setTimeout(() => {
    const slides = Array.from(carousel.querySelectorAll(".meal-day-slide"));
    const containerLeft = carousel.getBoundingClientRect().left;
    let nextDate = selectedMealDate;
    let bestDistance = Number.POSITIVE_INFINITY;
    slides.forEach((slide) => {
      const distance = Math.abs(slide.getBoundingClientRect().left - containerLeft);
      if (distance < bestDistance) {
        bestDistance = distance;
        nextDate = slide.dataset.date || nextDate;
      }
    });
    if (nextDate && nextDate !== selectedMealDate) {
      selectedMealDate = nextDate;
      expandedMealId = null;
      updateMealDayTitle(days);
      updateMealDayStripActive();
    }
  }, 80);
}

function updateMealDayTitle(days) {
  if (!els.mealListTitle || !days.length) return;
  const date = selectedMealDate || days[0];
  const index = Math.max(0, days.indexOf(date));
  els.mealListTitle.textContent = `Tag ${index + 1}: ${formatDateInput(date)}`;
}

function updateMealDayStripActive() {
  if (!els.mealDayStrip) return;
  els.mealDayStrip.querySelectorAll("button[data-date]").forEach((button) => {
    button.classList.toggle("active", button.dataset.date === selectedMealDate);
  });
}

function scrollMealDayTo(date) {
  const slide = els.mealList?.querySelector(`.meal-day-slide[data-date="${CSS.escape(date)}"]`);
  if (slide) slide.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
}

function renderMealCalendar(trip, days) {
  if (els.mealCalendarSummary) {
    const planned = trip.meals.length || 0;
    els.mealCalendarSummary.textContent = days.length ?
       `${days.length} Reisetage · ${planned} Gerichte`
      : "Anreise und Dauer in Reise bearbeiten eintragen";
  }
  if (els.mealCalendarGrid) {
    els.mealCalendarGrid.innerHTML = "";
    if (!days.length) {
      els.mealCalendarGrid.innerHTML = `<div class="empty-state">Noch keine Reisedaten für den Kalender.</div>`;
    } else {
      days.forEach((date, index) => {
        const meals = trip.meals.filter((meal) => meal.date === date);
        const outfitReady = hasOutfitForDate(trip, date, index);
        const weather = weatherForDate(trip, date);
        const weatherInfo = weather ? weatherDisplay(weather.code) : null;
        const card = document.createElement("article");
        card.className = `meal-calendar-day ${date === selectedMealDate ? "active" : ""}`;
        card.dataset.date = date;
        card.innerHTML = `
          <button class="meal-calendar-main" data-calendar-main="true" type="button">
            <span>Tag ${index + 1}</span>
            <strong>${escapeHtml(shortDateLabel(date))}</strong>
            <small>${weather ? `${escapeHtml(weatherIcon(weather.code))} ${escapeHtml(weather.weather)}${weather.estimated ? " · Prognose" : ""}` : `${meals.length}/3 Essen · ${outfitReady ? "Outfit" : "kein Outfit"}`}</small>
          </button>
          <div class="calendar-day-actions">
            <button type="button" data-calendar-action="outfit" onclick="addOutfitForDate('${escapeHtml(date)}')">Outfit</button>
            <button type="button" data-calendar-action="meal" onclick="openMealPlannerForDate('${escapeHtml(date)}')">Essen</button>
            <button type="button" data-calendar-action="takeaway" onclick="openMealPlannerForDate('${escapeHtml(date)}', 'takeaway')">Mitnehmen</button>
            <button type="button" data-calendar-action="eatout" onclick="addEatOutForDate('${escapeHtml(date)}')">Essen gehen</button>
          </div>
        `;
        if (weatherInfo) {
          card.querySelector("small").innerHTML = `<span class="weather-symbol">${escapeHtml(weatherInfo.icon)}</span> ${escapeHtml(weatherInfo.label)} · ${meals.length}/3 Essen${weather.estimated ? " · Prognose" : ""}`;
        }
        const outfitButton = card.querySelector('[data-calendar-action="outfit"]');
        const handleOutfitAction = (event) => {
          event.stopPropagation();
          event.preventDefault();
          addOutfitForDate(date);
        };
        outfitButton.onclick = handleOutfitAction;
        outfitButton.onpointerup = handleOutfitAction;
        card.querySelector('[data-calendar-action="meal"]').onclick = (event) => {
          event.stopPropagation();
          openMealPlannerForDate(date);
        };
        card.querySelector('[data-calendar-action="takeaway"]').onclick = (event) => {
          event.stopPropagation();
          openMealPlannerForDate(date, "takeaway");
        };
        card.querySelector('[data-calendar-action="eatout"]').onclick = (event) => {
          event.stopPropagation();
          addEatOutForDate(date);
        };
        els.mealCalendarGrid.append(card);
      });
    }
  }
  if (els.mealDayStrip) {
    els.mealDayStrip.innerHTML = "";
    if (!days.length) {
      els.mealDayStrip.innerHTML = `<span class="muted">Keine Reisetage</span>`;
      return;
    }
    if (!selectedMealDate || !days.includes(selectedMealDate)) selectedMealDate = days[0];
    days.forEach((date, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.date = date;
      button.className = date === selectedMealDate ? "active" : "";
      button.textContent = `Tag ${index + 1}`;
      button.addEventListener("click", () => {
        selectedMealDate = date;
        expandedMealId = null;
        updateMealDayTitle(days);
        updateMealDayStripActive();
        scrollMealDayTo(date);
      });
      els.mealDayStrip.append(button);
    });
  }
}

function outfitGroupForDate(date) {
  const days = tripMealDays(activeTrip());
  const index = Math.max(0, days.indexOf(date));
  return `Outfit ${index + 1}`;
}

function outfitNameForDate(date) {
  const days = tripMealDays(activeTrip());
  const index = Math.max(0, days.indexOf(date));
  return `Outfit Tag ${index + 1}`;
}

function hasOutfitForDate(trip, date) {
  const group = outfitGroupForDate(date);
  return (trip.items || []).some((item) => item.category === "Kleidung" && item.group === group);
}

function addOutfitForDate(date) {
  if (!requireSignedInForEdit()) return;
  const trip = activeTrip();
  const group = outfitGroupForDate(date);
  const name = outfitNameForDate(date);
  const exists = (trip.items || []).some((item) => normalizeTemplateName(item.name) === normalizeTemplateName(name) && item.group === group);
  if (exists) {
    setCloudStatus(`${name} ist schon angelegt.`, currentUser ? "online" : "local");
    return;
  }
  trip.items.push(makeItem(name, "Kleidung", defaultAssignee(), { group }));
  activePackCategory = "Kleidung";
  addActivityToTrip(trip, `${name} angelegt`);
  setCloudStatus(`${name} wurde zur Packliste hinzugefügt.`, currentUser ? "online" : "local");
  commit();
}

function openMealPlannerForDate(date, mode = "meal") {
  selectedMealDate = date;
  foodMode = "meals";
  const slot = mode === "takeaway" ? "lunch" : "dinner";
  const name = mode === "takeaway" ? "Mitnehmen" : "";
  openMealDialog(null, { date, slot, name });
}

function addEatOutForDate(date) {
  if (!requireSignedInForEdit()) return;
  const trip = activeTrip();
  trip.meals ||= [];
  const exists = trip.meals.some((meal) => meal.date === date && (meal.slot || "dinner") === "dinner" && normalizeTemplateName(meal.name) === "essen gehen");
  if (!exists) {
    addMealToTrip({
      name: "Essen gehen",
      note: "Außer Haus",
      date,
      slot: "dinner",
      ingredients: []
    }, { saveTemplate: false });
  } else {
    selectedMealDate = date;
    foodMode = "meals";
    activateView("food");
    setCloudStatus("Essen gehen ist für diesen Tag schon geplant.", currentUser ? "online" : "local");
  }
}

try {
  window.addOutfitForDate = addOutfitForDate;
  window.openMealPlannerForDate = openMealPlannerForDate;
  window.addEatOutForDate = addEatOutForDate;
} catch {}

function renderMealBucketCompact(title, subtitle, meals) {
  const section = document.createElement("section");
  section.className = "meal-day-card meal-day-current";
  section.innerHTML = `
    <div class="meal-day-head">
      <strong>${escapeHtml(title)}</strong>
      ${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ""}
    </div>
    <div class="meal-name-list"></div>
  `;
  const list = section.querySelector(".meal-name-list");
  meals.forEach((meal) => list.append(createMealCardCompact(meal, activeTrip())));
  els.mealList.append(section);
}

function createMealCardCompact(meal, trip) {
  const expanded = expandedMealId === meal.id;
  const card = document.createElement("article");
  card.className = `meal-card ${expanded ? "expanded" : ""} ${canEditLists() ? "" : "read-only"}`;
  const isSnack = meal.type === "snack";
  const snackQuantity = isSnack ? (meal.ingredients || [])[0]?.quantity || "" : "";
  const ingredients = (meal.ingredients || [])
    .map((ingredient, index) => {
      const shoppingItem = ingredient.itemId
        ? trip.items.find((entry) => entry.id === ingredient.itemId)
        : trip.items.find((entry) => entry.category === "Nahrung" && normalizeTemplateName(entry.name) === normalizeTemplateName(ingredient.name));
      const onShoppingList = Boolean(shoppingItem?.shopping);
      return `
        <li>
          <span>
            <strong>${escapeHtml(ingredient.name)}</strong>
            ${ingredient.quantity ? `<small>${escapeHtml(ingredient.quantity)}</small>` : ""}
          </span>
          ${onShoppingList ? "" : `
            <button
              class="ingredient-shopping-button"
              data-meal-id="${escapeHtml(meal.id)}"
              data-ingredient-index="${index}"
              type="button"
              aria-label="${escapeHtml(ingredient.name)} zur Einkaufsliste hinzufügen"
              title="Zur Einkaufsliste hinzufügen"
            ></button>
          `}
        </li>
      `;
    })
    .join("");
  card.innerHTML = `
    <div class="meal-card-head">
      <div>
        <strong>${escapeHtml(meal.name)}</strong>
        <p>${isSnack ? escapeHtml(snackQuantity || "Menge offen") : `${(meal.ingredients || []).length} ${(meal.ingredients || []).length === 1 ? "Zutat" : "Zutaten"}`}</p>
      </div>
    </div>
    ${isSnack ? "" : `<ul class="meal-ingredients" ${expanded ? "" : "hidden"}>${ingredients || "<li><span>Keine Zutaten gespeichert</span></li>"}</ul>`}
  `;
  card.querySelectorAll(".ingredient-shopping-button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      addMealIngredientToShoppingList(button.dataset.mealId, Number(button.dataset.ingredientIndex));
    });
  });
  card.addEventListener("click", () => {
    if (expandedMealId === meal.id) {
      if (!canEditLists()) {
        setCloudStatus("Melde dich an, um Gerichte zu bearbeiten.", "local");
        return;
      }
      openMealDialog(meal);
      return;
    }
    expandedMealId = meal.id;
    renderMealsCompact(activeTrip());
  });
  return card;
}

function shortDateLabel(date) {
  if (!date) return "";
  const [, month, day] = date.split("-");
  return `${day}.${month}.`;
}

function weatherForDate(trip, date) {
  const cached = weatherCache.get(trip.id);
  if (!cached?.days?.length) return null;
  return cached.days.find((day) => day.date === date) || null;
}

function weatherIcon(code) {
  if ([0, 1].includes(Number(code))) return "☀";
  if ([2, 3].includes(Number(code))) return "☁";
  if ([45, 48].includes(Number(code))) return "≋";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(Number(code))) return "☂";
  if ([71, 73, 75, 77, 85, 86].includes(Number(code))) return "❄";
  if ([95, 96, 99].includes(Number(code))) return "⚡";
  return "•";
}

function completeShoppingList() {
  if (!requireSignedInForEdit()) return;
  const trip = activeTrip();
  const shoppingItems = trip.items.filter((item) => item.shopping);
  if (!shoppingItems.length || shoppingItems.some((item) => !item.bought)) return;
  shoppingItems.forEach((item) => {
    item.shopping = false;
    item.bought = false;
  });
  addActivityToTrip(trip, "Einkauf abgeschlossen");
  commit();
}

function renderMeals(trip) {
  if (!els.mealList) return;
  trip.meals ||= [];
  if (selectedMealId && !trip.meals.some((meal) => meal.id === selectedMealId)) selectedMealId = null;
  if (els.mealCentralActions) els.mealCentralActions.hidden = true;
  els.mealList.innerHTML = "";
  const days = tripMealDays(trip);
  const plannedCount = trip.meals.length;
  const neededCount = days.length ? days.length * mealSlots.length : 0;
  const summary = document.createElement("div");
  summary.className = "meal-plan-summary";
  summary.innerHTML = `
    <strong>${plannedCount}/${neededCount || plannedCount} Mahlzeiten geplant</strong>
    <span>${days.length ? `${days.length} Reisetage · Frühstück, Mittag und Abendessen` : "Trage in der Reise Anreise und Dauer ein, dann entsteht hier ein Tagesplan."}</span>
  `;
  els.mealList.append(summary);
  if (!days.length) {
    if (!trip.meals.length) {
      els.mealList.insertAdjacentHTML("beforeend", `<div class="empty-state">Noch kein Gericht geplant. Lege ein Gericht über das Plus an.</div>`);
      return;
    }
    renderMealBucket("Ohne Datum", "", trip.meals);
    return;
  }
  days.forEach((date, index) => {
    const dayMeals = trip.meals.filter((meal) => (meal.date || "") === date);
    const section = document.createElement("section");
    section.className = "meal-day-card";
    section.innerHTML = `
      <div class="meal-day-head">
        <strong>Tag ${index + 1}</strong>
        <span>${escapeHtml(formatDateInput(date))}</span>
      </div>
      <div class="meal-slot-grid"></div>
    `;
    const slotGrid = section.querySelector(".meal-slot-grid");
    mealSlots.forEach((slot) => {
      const slotMeals = dayMeals.filter((meal) => (meal.slot || "dinner") === slot.id);
      const slotCard = document.createElement("div");
      slotCard.className = "meal-slot-card";
      slotCard.innerHTML = `<h4>${escapeHtml(slot.label)}</h4>`;
      if (!slotMeals.length) {
        slotCard.insertAdjacentHTML("beforeend", `<button class="meal-empty-slot" type="button">Gericht planen</button>`);
        slotCard.querySelector("button").addEventListener("click", () => openMealDialog(null, { date, slot: slot.id }));
      } else {
        slotMeals.forEach((meal) => slotCard.append(createMealCard(meal, trip)));
      }
      slotGrid.append(slotCard);
    });
    els.mealList.append(section);
  });
  const unscheduled = trip.meals.filter((meal) => meal.date && !days.includes(meal.date) || !meal.date);
  if (unscheduled.length) renderMealBucket("Ohne passenden Reisetag", "Noch keinem Reisetag zugeordnet", unscheduled);
}

function renderMealBucket(title, subtitle, meals) {
  const section = document.createElement("section");
  section.className = "meal-day-card";
  section.innerHTML = `
    <div class="meal-day-head">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(subtitle)}</span>
    </div>
    <div class="meal-slot-grid single"></div>
  `;
  const grid = section.querySelector(".meal-slot-grid");
  meals.forEach((meal) => grid.append(createMealCard(meal, activeTrip())));
  els.mealList.append(section);
}

function createMealCard(meal, trip) {
  const card = document.createElement("article");
  card.className = `meal-card ${canEditLists() ? "" : "read-only"}`;
  const ingredients = (meal.ingredients || [])
    .map((ingredient, index) => {
      const shoppingItem = ingredient.itemId
        ? trip.items.find((entry) => entry.id === ingredient.itemId)
        : trip.items.find((entry) => entry.category === "Nahrung" && normalizeTemplateName(entry.name) === normalizeTemplateName(ingredient.name));
      const onShoppingList = Boolean(shoppingItem?.shopping);
      return `
        <li>
          <span>
            <strong>${escapeHtml(ingredient.name)}</strong>
            ${ingredient.quantity ? `<small>${escapeHtml(ingredient.quantity)}</small>` : ""}
          </span>
          ${onShoppingList ? "" : `
            <button
              class="ingredient-shopping-button"
              data-meal-id="${escapeHtml(meal.id)}"
              data-ingredient-index="${index}"
              type="button"
              aria-label="${escapeHtml(ingredient.name)} zur Einkaufsliste hinzufügen"
              title="Zur Einkaufsliste hinzufügen"
            ></button>
          `}
        </li>
      `;
    })
    .join("");
  card.innerHTML = `
    <div class="meal-card-head">
      <div>
        <strong>${escapeHtml(meal.name)}</strong>
        <p>${(meal.ingredients || []).length} ${(meal.ingredients || []).length === 1 ? "Zutat" : "Zutaten"}</p>
      </div>
    </div>
    <ul class="meal-ingredients">${ingredients}</ul>
  `;
  card.querySelectorAll(".ingredient-shopping-button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      addMealIngredientToShoppingList(button.dataset.mealId, Number(button.dataset.ingredientIndex));
    });
  });
  card.addEventListener("click", () => {
    if (!canEditLists()) {
      setCloudStatus("Melde dich an, um Gerichte zu bearbeiten.", "local");
      return;
    }
    openMealDialog(meal);
  });
  return card;
}

function tripMealDays(trip) {
  const days = [];
  if (!trip.startDate || !trip.endDate) return days;
  const duration = calculateTripDuration(trip.startDate, trip.endDate);
  if (!duration || duration.invalid) return days;
  const planningDays = Math.max(1, duration.days || 1);
  let current = trip.startDate;
  while (current && days.length < planningDays) {
    days.push(current);
    const next = addDaysToDateInput(current, 1);
    if (!next || next === current) break;
    current = next;
  }
  return days;
}

function mealSlotLabel(slot) {
  return mealSlots.find((entry) => entry.id === slot).label || "Abendessen";
}

function selectedMeal() {
  return activeTrip().meals.find((meal) => meal.id === selectedMealId);
}

function repeatMeal(meal) {
  if (!meal) return;
  addMealToTrip({
    name: meal.name,
    type: meal.type === "snack" ? "snack" : "meal",
    note: "",
    ingredients: (meal.ingredients || []).map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.quantity || ""
    }))
  }, { saveTemplate: false });
}

function repeatSelectedMeal() {
  repeatMeal(selectedMeal());
}

function deleteMealById(mealId) {
  if (!requireSignedInForEdit()) return;
  const trip = activeTrip();
  const meal = (trip.meals || []).find((entry) => entry.id === mealId);
  if (!meal) return;
  trip.meals = (trip.meals || []).filter((entry) => entry.id !== meal.id);
  if (selectedMealId === meal.id) selectedMealId = null;
  if (editingMealId === meal.id) closeMealDialog();
  addActivityToTrip(trip, `${meal.name} aus Essen entfernt`);
  commit();
}

function deleteSelectedMeal() {
  const meal = selectedMeal();
  if (meal) deleteMealById(meal.id);
}

function renderMealTemplateOptions() {
  if (!els.mealTemplateSelect) return;
  const query = (els.mealTemplateSearchInput.value || "").trim().toLowerCase();
  if (!query) {
    els.mealTemplateSelect.innerHTML = "";
    els.mealTemplateSelect.hidden = true;
    els.mealTemplateSelect.style.display = "none";
    els.mealTemplateSelect.disabled = true;
    els.mealTemplateForm.querySelector("button[type='submit']").setAttribute("disabled", "true");
    renderMealTemplatePreview(null);
    return;
  }
  const templates = availableMealTemplates().filter((template) => {
    const haystack = `${template.name} ${template.ingredients.map((ingredient) => ingredient.name).join(" ")}`.toLowerCase();
    return !query || haystack.includes(query);
  });
  els.mealTemplateSelect.innerHTML = templates
    .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`)
    .join("");
  els.mealTemplateSelect.disabled = templates.length === 0;
  const submitButton = els.mealTemplateForm.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = templates.length === 0;
  els.mealTemplateSelect.hidden = false;
  els.mealTemplateSelect.style.display = "block";
  els.mealTemplateSelect.size = Math.min(6, Math.max(2, templates.length || 2));
  if (templates.length) els.mealTemplateSelect.value = templates[0].id;
  renderMealTemplatePreview(templates.length ? templates[0] : null);
}

function renderMealTemplatePreview(template = null) {
  if (!els.mealTemplatePreview) return;
  if (!template) {
    els.mealTemplatePreview.hidden = true;
    els.mealTemplatePreview.innerHTML = "";
    return;
  }
  const ingredients = (template.ingredients || [])
    .slice(0, 8)
    .map((ingredient) => `<span>${escapeHtml(ingredient.name)}${ingredient.quantity ? ` · ${escapeHtml(ingredient.quantity)}` : ""}</span>`)
    .join("");
  els.mealTemplatePreview.hidden = false;
  els.mealTemplatePreview.innerHTML = `
    <strong>${escapeHtml(template.name)}</strong>
    <div>${ingredients || "<span>Keine Zutaten gespeichert</span>"}</div>
  `;
}

function renderMealDialogTemplateOptions() {
  if (!els.mealDialogTemplateSelect) return;
  els.mealDialogTemplateSelect.innerHTML = "";
  els.mealDialogTemplateSelect.hidden = true;
  els.mealDialogTemplateSelect.style.display = "none";
  els.mealDialogTemplateSelect.disabled = true;
  if (els.useMealDialogTemplateButton) els.useMealDialogTemplateButton.disabled = true;
  renderMealDialogTemplatePreview(null);
  return;
  const query = (els.mealNameInput.value || els.mealDialogTemplateSearchInput.value || "").trim().toLowerCase();
  if (!query) {
    els.mealDialogTemplateSelect.innerHTML = "";
    els.mealDialogTemplateSelect.hidden = true;
    els.mealDialogTemplateSelect.style.display = "none";
    els.mealDialogTemplateSelect.disabled = true;
    if (els.useMealDialogTemplateButton) els.useMealDialogTemplateButton.disabled = true;
    renderMealDialogTemplatePreview(null);
    return;
  }
  const templates = availableMealTemplates().filter((template) => {
    const haystack = `${template.name} ${template.ingredients.map((ingredient) => ingredient.name).join(" ")}`.toLowerCase();
    return haystack.includes(query);
  });
  els.mealDialogTemplateSelect.innerHTML = templates
    .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`)
    .join("");
  els.mealDialogTemplateSelect.hidden = false;
  els.mealDialogTemplateSelect.style.display = "block";
  els.mealDialogTemplateSelect.size = Math.min(6, Math.max(2, templates.length || 2));
  els.mealDialogTemplateSelect.disabled = templates.length === 0;
  if (els.useMealDialogTemplateButton) els.useMealDialogTemplateButton.disabled = templates.length === 0;
  if (templates.length) els.mealDialogTemplateSelect.value = templates[0].id;
  renderMealDialogTemplatePreview(templates.length ? templates[0] : null);
}

function renderMealDialogTemplatePreview(template = null) {
  if (!els.mealDialogTemplatePreview) return;
  if (!template) {
    els.mealDialogTemplatePreview.hidden = true;
    els.mealDialogTemplatePreview.innerHTML = "";
    return;
  }
  const ingredients = (template.ingredients || [])
    .slice(0, 8)
    .map((ingredient) => `<span>${escapeHtml(ingredient.name)}${ingredient.quantity ? ` · ${escapeHtml(ingredient.quantity)}` : ""}</span>`)
    .join("");
  els.mealDialogTemplatePreview.hidden = false;
  els.mealDialogTemplatePreview.innerHTML = `
    <strong>${escapeHtml(template.name)}</strong>
    <div>${ingredients || "<span>Keine Zutaten gespeichert</span>"}</div>
  `;
}

function useMealTemplateInDialog() {
  const template = availableMealTemplates().find((entry) => entry.id === els.mealDialogTemplateSelect.value);
  if (!template) {
    setCloudStatus("Tippe zuerst ein Gericht in die Suche ein.", currentUser ? "online" : "local");
    return;
  }
  els.mealNameInput.value = template.name;
  if (els.mealDialogTemplateSelect) els.mealDialogTemplateSelect.hidden = true;
  pendingMealIngredients = (template.ingredients || []).map((ingredient) => ({
    id: crypto.randomUUID(),
    name: ingredient.name,
    quantity: ingredient.quantity || ""
  }));
  renderPendingMealIngredients();
  updateMealDialogProgressiveFields();
}

function availableMealTemplates() {
  state.mealTemplates ||= [];
  const byName = new Map();
  state.mealTemplates.forEach((template) => {
    const key = normalizeTemplateName(template.name);
    if (!byName.has(key)) byName.set(key, template);
  });
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

function saveMealAsTemplate(mealInput) {
  state.mealTemplates ||= [];
  const key = normalizeTemplateName(mealInput.name);
  const template = {
    id: `meal-${key || crypto.randomUUID()}`,
    name: mealInput.name,
    note: "",
    ingredients: mealInput.ingredients.map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.quantity || ""
    }))
  };
  const existingIndex = state.mealTemplates.findIndex((entry) => normalizeTemplateName(entry.name) === key);
  if (existingIndex >= 0) {
    state.mealTemplates[existingIndex] = { ...state.mealTemplates[existingIndex], ...template };
  } else {
    state.mealTemplates.unshift(template);
  }
}

function addMealTemplateFromForm() {
  if (!requireSignedInForEdit()) return;
  const template = availableMealTemplates().find((entry) => entry.id === els.mealTemplateSelect.value);
  if (!template) {
    setCloudStatus("Tippe zuerst ein Gericht in die Suche ein.", currentUser ? "online" : "local");
    return;
  }
  addMealToTrip({
    name: template.name,
    type: mealKind,
    note: template.note,
    ingredients: template.ingredients
  }, { saveTemplate: false });
  els.mealTemplateSearchInput.value = "";
  renderMealTemplateOptions();
}

function addMealFromForm() {
  if (!requireSignedInForEdit()) return;
  const { name, ingredients } = readMealDialogInput();
  if (!name) return;
  if (editingMealId) {
    updateMealFromDialog(name, ingredients);
  } else {
    addMealToTrip({
      name,
      type: currentMealDialogKind,
      note: "",
      date: "",
      slot: "",
      ingredients
    });
  }
  pendingMealIngredients = [];
  if (els.snackQuantityInput) els.snackQuantityInput.value = "";
  renderPendingMealIngredients();
  els.mealForm.reset();
  closeMealDialog();
}

function renderMealDateOptions(selectedDate = "") {
  if (!els.mealDateSelect) return;
  const days = tripMealDays(activeTrip());
  els.mealDateSelect.innerHTML = [
    `<option value="">Ohne Datum</option>`,
    ...days.map((date, index) => `<option value="${escapeHtml(date)}">Tag ${index + 1} · ${escapeHtml(formatDateInput(date))}</option>`)
  ].join("");
  els.mealDateSelect.value = days.includes(selectedDate) || selectedDate === "" ? selectedDate : "";
}

function mealDayContextText(date) {
  const days = tripMealDays(activeTrip());
  const index = days.indexOf(date);
  if (!date || index < 0) return "";
  return `Tag ${index + 1} · ${formatDateInput(date)}`;
}

function renderMealDialogDayPicker(selectedDate = "", options = {}) {
  if (!els.mealDialogDayStrip || !els.mealDateSelect) return;
  const days = tripMealDays(activeTrip());
  els.mealDialogDayStrip.innerHTML = "";
  const lockedDate = Boolean(options.lockedDate && els.mealDateSelect.value);
  const lockedSlot = Boolean(options.lockedSlot && els.mealSlotSelect.value);
  if (lockedDate) {
    els.mealDialogDayStrip.hidden = true;
    if (els.mealDialogPlanContext) {
      const slotText = lockedSlot ? ` · ${mealSlotLabel(els.mealSlotSelect.value)}` : "";
      els.mealDialogPlanContext.textContent = `${mealDayContextText(els.mealDateSelect.value)}${slotText}`;
      els.mealDialogPlanContext.textContent = mealDayContextText(els.mealDateSelect.value);
      els.mealDialogPlanContext.hidden = false;
    }
    renderMealDialogSlotButtons({ lockedSlot });
    return;
  }
  els.mealDialogDayStrip.hidden = false;
  if (els.mealDialogPlanContext) {
    els.mealDialogPlanContext.hidden = true;
    els.mealDialogPlanContext.textContent = "";
  }
  if (!days.length) {
    els.mealDialogDayStrip.innerHTML = `<span class="muted">Kein Reisedatum hinterlegt</span>`;
    if (els.mealDialogSlotButtons) els.mealDialogSlotButtons.hidden = true;
    return;
  }
  days.forEach((date, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = els.mealDateSelect.value === date || (!els.mealDateSelect.value && selectedDate === date) ? "active" : "";
    button.textContent = `Tag ${index + 1}`;
    button.addEventListener("click", () => {
      els.mealDateSelect.value = date;
      renderMealDialogDayPicker(date);
      renderMealDialogSlotButtons();
    });
    els.mealDialogDayStrip.append(button);
  });
  renderMealDialogSlotButtons();
}

function renderMealDialogSlotButtons(options = {}) {
  if (!els.mealDialogSlotButtons || !els.mealSlotSelect) return;
  els.mealDialogSlotButtons.hidden = true;
  els.mealDialogSlotButtons.innerHTML = "";
}

function updateMealDialogProgressiveFields() {
  const hasName = Boolean(els.mealNameInput.value.trim());
  const isSnack = currentMealDialogKind === "snack";
  if (els.mealBuilderPanel) els.mealBuilderPanel.hidden = isSnack || !hasName;
  if (els.snackQuantityField) els.snackQuantityField.hidden = !isSnack;
}

function readMealDialogInput() {
  const name = els.mealNameInput.value.trim();
  const ingredients = currentMealDialogKind === "snack"
    ? [{ id: crypto.randomUUID(), name, quantity: combineSnackQuantity(els.snackQuantityInput?.value) }]
    : pendingMealIngredients.map((ingredient) => ({ ...ingredient }));
  return { name, ingredients };
}

function scheduleMealDialogAutosave() {
  if (!editingMealId || !canEditLists()) return;
  window.clearTimeout(mealDialogAutosaveTimer);
  mealDialogAutosaveTimer = window.setTimeout(() => {
    const { name, ingredients } = readMealDialogInput();
    if (!name) return;
    updateMealFromDialog(name, ingredients, { announce: false });
  }, 450);
}

function openMealDialog(meal = null, defaults = {}) {
  if (!requireEditableActiveTrip()) return;
  editingMealId = meal?.id || null;
  currentMealDialogKind = meal?.type === "snack" || defaults.type === "snack" ? "snack" : "meal";
  const kindLabel = currentMealDialogKind === "snack" ? "Snack" : "Gericht";
  pendingMealIngredients = meal
    ? (meal.ingredients || []).map((ingredient) => ({
        id: crypto.randomUUID(),
        name: ingredient.name,
        quantity: ingredient.quantity || ""
      }))
    : [];
  els.mealForm.reset();
  if (els.mealDialogTemplateSearchInput) els.mealDialogTemplateSearchInput.value = "";
  renderMealDialogTemplateOptions();
  els.mealDialogTitle.textContent = meal ? `${kindLabel} bearbeiten` : `${kindLabel} hinzufügen`;
  if (els.mealNameLabel) els.mealNameLabel.textContent = kindLabel;
  if (els.mealSaveButton) {
    els.mealSaveButton.hidden = Boolean(meal);
    els.mealSaveButton.textContent = `${kindLabel} hinzufügen`;
  }
  if (els.deleteMealDialogButton) els.deleteMealDialogButton.textContent = `${kindLabel} löschen`;
  els.mealNameInput.value = meal?.name || defaults.name || "";
  els.mealNameInput.placeholder = `${kindLabel} eingeben`;
  const snackQuantity = currentMealDialogKind === "snack" ? splitQuantity((meal?.ingredients || [])[0]?.quantity || "") : { amount: "", unit: "g" };
  if (els.snackQuantityInput) els.snackQuantityInput.value = snackQuantity.amount || "";
  renderMealDialogTemplateOptions();
  renderMealDateOptions("");
  if (els.mealSlotSelect) els.mealSlotSelect.value = "";
  renderMealDialogDayPicker("");
  if (els.mealDialogActions) els.mealDialogActions.hidden = !meal;
  els.mealDialog.hidden = false;
  renderPendingMealIngredients();
  updateMealDialogProgressiveFields();
  window.setTimeout(() => els.mealNameInput.focus(), 0);
}

function closeMealDialog() {
  window.clearTimeout(mealDialogAutosaveTimer);
  if (editingMealId) {
    const { name, ingredients } = readMealDialogInput();
    if (name) updateMealFromDialog(name, ingredients, { announce: false });
  }
  editingMealId = null;
  if (els.mealDialogActions) els.mealDialogActions.hidden = true;
  if (els.mealSaveButton) els.mealSaveButton.hidden = false;
  els.mealDialog.hidden = true;
}

function updateMealFromDialog(name, ingredients, options = {}) {
  if (!requireSignedInForEdit()) return;
  const trip = activeTrip();
  const meal = (trip.meals || []).find((entry) => entry.id === editingMealId);
  if (!meal) return;
  meal.name = name;
  meal.type = currentMealDialogKind;
  meal.date = "";
  meal.slot = "";
  meal.ingredients = ingredients.map((ingredient) => ({ ...ingredient }));
  if (currentMealDialogKind !== "snack") saveMealAsTemplate({ name, ingredients });
  if (options.announce !== false) addActivityToTrip(trip, `${name} bearbeitet`);
  commit();
}

function openMealIngredientDialog(ingredientId = null) {
  if (!requireEditableActiveTrip()) return;
  editingMealIngredientId = ingredientId;
  const ingredient = pendingMealIngredients.find((entry) => entry.id === ingredientId);
  els.mealIngredientDialog.hidden = false;
  els.mealIngredientForm.reset();
  if (els.mealIngredientDialogTitle) els.mealIngredientDialogTitle.textContent = ingredient ? "Zutat bearbeiten" : "Zutat hinzufügen";
  const submitButton = els.mealIngredientForm.querySelector("button[type='submit']");
  if (submitButton) submitButton.textContent = ingredient ? "Zutat übernehmen" : "Zutat hinzufügen";
  if (ingredient) {
    els.mealIngredientNameInput.value = ingredient.name || "";
    const parsed = splitQuantity(ingredient.quantity || "");
    els.mealIngredientQuantityInput.value = parsed.amount || "";
    els.mealIngredientUnitSelect.value = parsed.unit || "g";
  }
  renderIngredientSuggestionOptions();
  window.setTimeout(() => els.mealIngredientNameInput.focus(), 0);
}

function closeMealIngredientDialog() {
  editingMealIngredientId = null;
  els.mealIngredientDialog.hidden = true;
}

function splitQuantity(quantity = "") {
  const match = String(quantity).trim().match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|Stück)$/i);
  if (!match) return { amount: "", unit: "g" };
  const unit = match[2] || "g";
  return { amount: match[1].replace(",", "."), unit };
}

function ingredientSuggestions() {
  const byName = new Map();
  const remember = (ingredient) => {
    const name = String(ingredient.name || "").trim();
    if (!name) return;
    const key = normalizeTemplateName(name);
    if (!byName.has(key)) byName.set(key, {
      name,
      quantity: String(ingredient.quantity || "").trim()
    });
  };
  activeTrip().meals.forEach((meal) => (meal.ingredients || []).forEach(remember));
  state.mealTemplates.forEach((template) => (template.ingredients || []).forEach(remember));
  activeTrip().items.filter((item) => item.category === "Nahrung").forEach(remember);
  state.globalItems.filter((item) => item.category === "Nahrung").forEach(remember);
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

function renderIngredientSuggestionOptions() {
  if (!els.mealIngredientSuggestionSelect) return;
  const query = (els.mealIngredientNameInput.value || "").trim().toLowerCase();
  if (!query) {
    els.mealIngredientSuggestionSelect.hidden = true;
    els.mealIngredientSuggestionSelect.innerHTML = "";
    return;
  }
  const matches = ingredientSuggestions()
    .filter((ingredient) => `${ingredient.name} ${ingredient.quantity}`.toLowerCase().includes(query))
    .slice(0, 8);
  els.mealIngredientSuggestionSelect.hidden = matches.length === 0;
  els.mealIngredientSuggestionSelect.size = Math.min(6, Math.max(2, matches.length));
  els.mealIngredientSuggestionSelect.innerHTML = matches
    .map((ingredient) => `<option value="${escapeHtml(ingredient.name)}" data-quantity="${escapeHtml(ingredient.quantity)}">${escapeHtml(ingredient.name)}${ingredient.quantity ? ` · ${escapeHtml(ingredient.quantity)}` : ""}</option>`)
    .join("");
}

function useIngredientSuggestion() {
  if (!els.mealIngredientSuggestionSelect.value) return;
  const option = els.mealIngredientSuggestionSelect.selectedOptions?.[0];
  const quantity = option.dataset.quantity || "";
  els.mealIngredientNameInput.value = els.mealIngredientSuggestionSelect.value;
  const parsed = splitQuantity(quantity);
  if (parsed.amount) els.mealIngredientQuantityInput.value = parsed.amount;
  if (parsed.unit && Array.from(els.mealIngredientUnitSelect.options).some((entry) => entry.value === parsed.unit)) {
    els.mealIngredientUnitSelect.value = parsed.unit;
  }
  els.mealIngredientSuggestionSelect.hidden = true;
}

function addPendingMealIngredientFromDialog() {
  if (!requireEditableActiveTrip()) return;
  const name = els.mealIngredientNameInput.value.trim();
  if (!name) return;
  const nextIngredient = {
    id: editingMealIngredientId || crypto.randomUUID(),
    name,
    quantity: combineQuantity(els.mealIngredientQuantityInput.value, els.mealIngredientUnitSelect.value)
  };
  if (editingMealIngredientId) {
    pendingMealIngredients = pendingMealIngredients.map((ingredient) => ingredient.id === editingMealIngredientId ? nextIngredient : ingredient);
  } else {
    pendingMealIngredients.push(nextIngredient);
  }
  els.mealIngredientForm.reset();
  closeMealIngredientDialog();
  renderIngredientSuggestionOptions();
  renderPendingMealIngredients();
  scheduleMealDialogAutosave();
}

function removePendingMealIngredient(id) {
  if (!requireEditableActiveTrip()) return;
  pendingMealIngredients = pendingMealIngredients.filter((ingredient) => ingredient.id !== id);
  renderPendingMealIngredients();
  scheduleMealDialogAutosave();
}

function renderPendingMealIngredients() {
  if (!els.mealIngredientList) return;
  if (!pendingMealIngredients.length) {
    els.mealIngredientList.innerHTML = `<div class="empty-state meal-builder-empty">Noch keine Zutaten. Füge jede Zutat einzeln hinzu.</div>`;
    return;
  }
  els.mealIngredientList.innerHTML = "";
  pendingMealIngredients.forEach((ingredient) => {
    const row = document.createElement("div");
    row.className = "meal-builder-row";
    row.innerHTML = `
      <span>
        <strong>${escapeHtml(ingredient.name)}</strong>
        ${ingredient.quantity ? `<small>${escapeHtml(ingredient.quantity)}</small>` : ""}
      </span>
      <button type="button" aria-label="${escapeHtml(ingredient.name)} entfernen">Entfernen</button>
    `;
    row.querySelector("button").addEventListener("click", () => removePendingMealIngredient(ingredient.id));
    row.querySelector("span").addEventListener("click", () => openMealIngredientDialog(ingredient.id));
    els.mealIngredientList.append(row);
  });
}

function addMealToTrip(mealInput, options = {}) {
  if (!requireEditableActiveTrip()) return;
  const trip = activeTrip();
  trip.meals ||= [];
  const shouldSaveTemplate = options.saveTemplate !== false && mealInput.type !== "snack";
  const meal = {
    id: crypto.randomUUID(),
    name: mealInput.name,
    type: mealInput.type === "snack" ? "snack" : "meal",
    note: mealInput.note || "",
    date: "",
    slot: "",
    ingredients: mealInput.ingredients.map((ingredient) => ({ ...ingredient }))
  };
  if (shouldSaveTemplate) saveMealAsTemplate(mealInput);
  trip.meals.unshift(meal);
  const kindLabel = meal.type === "snack" ? "Snack" : "Gericht";
  addActivityToTrip(trip, shouldSaveTemplate ? `${mealInput.name} als ${kindLabel} gespeichert` : `${mealInput.name} als ${kindLabel} übernommen`);
  commit();
  activateView("food");
}

function addFoodIngredientFromForm() {
  if (!requireEditableActiveTrip()) return;
  const name = els.foodIngredientNameInput.value.trim();
  if (!name) return;
  const trip = activeTrip();
  ensureShoppingIngredient(trip, {
    name,
    quantity: combineQuantity(els.foodIngredientQuantityInput.value, els.foodIngredientUnitSelect.value)
  }, "Essen");
  addActivityToTrip(trip, `${name} zur Einkaufsliste hinzugefügt`);
  els.foodIngredientForm.reset();
  commit();
  activateView("food");
  window.setTimeout(() => els.foodIngredientNameInput.focus(), 0);
}

function addFoodIngredientFromMealDialog() {
  if (!requireEditableActiveTrip()) return;
  const name = els.mealDialogFoodIngredientNameInput.value.trim();
  if (!name) return;
  const trip = activeTrip();
  ensureShoppingIngredient(trip, {
    name,
    quantity: combineQuantity(els.mealDialogFoodIngredientQuantityInput.value, els.mealDialogFoodIngredientUnitSelect.value)
  }, "Essen");
  addActivityToTrip(trip, `${name} zur Einkaufsliste hinzugefügt`);
  commit();
  if (els.mealDialogFoodIngredientNameInput) els.mealDialogFoodIngredientNameInput.value = "";
  if (els.mealDialogFoodIngredientQuantityInput) els.mealDialogFoodIngredientQuantityInput.value = "";
  window.setTimeout(() => els.mealDialogFoodIngredientNameInput.focus(), 0);
}

function combineQuantity(value, unit) {
  const amount = String(value || "").trim();
  if (!amount) return "";
  return `${amount} ${unit || ""}`.trim();
}

function combineSnackQuantity(value) {
  const amount = String(value || "").trim();
  if (!amount) return "";
  return `${amount} Stück`;
}

function ensureShoppingIngredient(trip, ingredient, mealName) {
  if (!canEditLists()) return "";
  const normalized = normalizeTemplateName(ingredient.name);
  const existing = trip.items.find((item) => item.category === "Nahrung" && normalizeTemplateName(item.name) === normalized);
  if (existing) {
    existing.shopping = true;
    existing.quantity ||= ingredient.quantity;
    existing.note = existing.note || `Für ${mealName}`;
    return existing.id;
  }
  const item = makeItem(ingredient.name, "Nahrung", defaultAssignee(trip), {
    shopping: true,
    quantity: ingredient.quantity,
    note: `Für ${mealName}`
  });
  trip.items.push(item);
  return item.id;
}

function groupBy(items, getKey) {
  return items.reduce((groups, item) => {
    const key = getKey(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});
}

function createAccordionGroup(options, children) {
  const details = document.createElement("details");
  details.className = "list-group";
  if (options.lockedOpen) details.classList.add("locked-open");
  details.open = options.open;

  const summary = document.createElement("summary");
  summary.className = "list-group-summary";
  if (options.lockedOpen) {
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      details.open = true;
    });
  }
  summary.innerHTML = `
    <span>${escapeHtml(options.title)}</span>
    <span>${escapeHtml(options.meta)}</span>
  `;

  const body = document.createElement("div");
  body.className = options.className;
  children.forEach((child) => body.append(child));

  details.append(summary, body);
  return details;
}

function renderPeople(trip) {
  els.teamSummary.hidden = true;
  els.teamSummary.innerHTML = "";

  els.peopleList.innerHTML = "";
  peopleForAssignment(trip).forEach((person) => {
    const personItems = trip.items.filter((item) => displayAssignee(item.assignee) === person);
    const count = personItems.length;
    const packed = personItems.filter((item) => item.packed).length;
    const open = personItems.filter((item) => !item.packed).length;
    const progress = count ? Math.round((packed / count) * 100) : 0;
    const card = document.createElement("article");
    card.className = "person-card";
    card.innerHTML = `
      <div class="person-card-head">
        <span class="person-avatar">${escapeHtml(initials(person))}</span>
        <div>
          <strong>${escapeHtml(person)}</strong>
          <p class="muted">${packed}/${count} erledigt${open ? ` · ${open} offen` : ""}</p>
        </div>
      </div>
      <span class="trip-card-progress" aria-hidden="true"><span style="width: ${progress}%"></span></span>
    `;
    els.peopleList.append(card);
  });
  const activities = (trip.activity || []).map(normalizeActivityEntry);
  els.activityCount.textContent = String(activities.length);
  els.activityList.innerHTML = activities
    .map((entry) => `<div class="activity-entry">${escapeHtml(entry.message)}</div>`)
    .join("");
}

function commit() {
  cloudMutationVersion += 1;
  saveState();
  render();
  scheduleCloudSave();
}

function friendlyStatusMessage(message, fallback = "Aktion konnte gerade nicht abgeschlossen werden.") {
  const text = String(message || "").trim();
  const normalized = text.toLowerCase();
  if (
    !text ||
    normalized === "failed to fetch" ||
    normalized.includes("networkerror") ||
    normalized.includes("fetch failed") ||
    normalized.includes("load failed")
  ) {
    return fallback;
  }
  return text;
}

function friendlyCloudError(error, fallback = "Cloud gerade nicht erreichbar. Deine Listen bleiben lokal gespeichert.") {
  return friendlyStatusMessage(error?.message || error, fallback);
}

function setCloudStatus(message, type = currentUser ? "online" : "local") {
  const effectiveType = type === "online" && !currentUser ? "local" : type;
  const statusMessage = friendlyStatusMessage(message, "Cloud gerade nicht erreichbar. Deine Listen bleiben lokal gespeichert.");
  els.cloudStatus.textContent = statusMessage;
  els.cloudBadge.textContent = effectiveType === "online" ? "Cloud" : effectiveType === "error" ? "Fehler" : "Lokal";
  els.cloudBadge.classList.toggle("online", effectiveType === "online");
  els.cloudBadge.classList.toggle("error", effectiveType === "error");
  if (els.syncStatusText) {
    els.syncStatusText.textContent = pendingCloudSave
      ? "Änderungen sind lokal gespeichert und warten auf die Cloud-Synchronisierung."
      : effectiveType === "online"
        ? "Lokale Änderungen und Cloud-Daten sind synchronisiert."
        : effectiveType === "error"
          ? `Synchronisierung nicht abgeschlossen: ${statusMessage}`
          : "Änderungen sind auf diesem Gerät gespeichert und werden bei bestehender Verbindung automatisch synchronisiert.";
  }
  showStatusToast(statusMessage, effectiveType);
}

function setAuthMessage(message, type = "info") {
  els.authMessage.hidden = !message;
  els.authMessage.textContent = message;
  els.authMessage.classList.toggle("error", type === "error");
  els.authMessage.classList.toggle("success", type === "success");
}

function setAuthMode(mode) {
  authMode = mode;
  authRecoveryMode = false;
  const isSignup = authMode === "signup";
  els.authDisplayNameField.hidden = !isSignup;
  els.authEmailField.hidden = false;
  document.querySelector("#authDialogTitle").textContent = isSignup ? "Konto erstellen" : "Einloggen";
  els.signupButton.textContent = isSignup ? "Konto erstellen" : "Neues Konto";
  els.backToLoginButton.hidden = !isSignup;
  els.loginButton.hidden = isSignup;
  els.resetPasswordButton.hidden = isSignup;
  els.signupButton.hidden = false;
  els.loginButton.textContent = "Einloggen";
  els.authDisplayNameInput.required = isSignup;
  els.authEmailInput.required = true;
  els.authPasswordConfirmField.hidden = !isSignup;
  els.authPasswordConfirmInput.required = isSignup;
  if (!isSignup) els.authPasswordConfirmInput.value = "";
  els.authPasswordInput.autocomplete = isSignup ? "new-password" : "current-password";
  if (!isSignup) els.authDisplayNameInput.value = "";
}

function enterPasswordRecoveryMode() {
  authRecoveryMode = true;
  authMode = "login";
  els.authDialog.hidden = false;
  els.authDisplayNameField.hidden = true;
  els.authEmailField.hidden = true;
  els.authPasswordConfirmField.hidden = false;
  els.signupButton.hidden = true;
  els.resetPasswordButton.hidden = true;
  els.backToLoginButton.hidden = true;
  els.loginButton.hidden = false;
  els.loginButton.textContent = "Neues Passwort speichern";
  els.authEmailInput.required = false;
  els.authPasswordInput.value = "";
  els.authPasswordConfirmInput.value = "";
  els.authPasswordInput.type = "password";
  els.togglePasswordButton.classList.remove("active");
  els.authPasswordInput.autocomplete = "new-password";
  els.authPasswordConfirmInput.required = true;
  document.querySelector("#authDialogTitle").textContent = "Passwort zurücksetzen";
  setAuthMessage("Gib dein neues Passwort ein und speichere es.", "success");
  window.setTimeout(() => els.authPasswordInput.focus(), 0);
}

function friendlyAuthError(error) {
  const message = error.message || "Beim Anmelden ist ein Fehler passiert.";
  const code = error.code || error.error_code;
  const normalized = message.toLowerCase();
  if (code === "email_address_invalid" || message.toLowerCase().includes("email address") && message.toLowerCase().includes("invalid")) {
    return "Diese E-Mail-Adresse wird nicht akzeptiert. Nutze bitte eine echte Adresse, die dir gehört.";
  }
  if (normalized.includes("rate limit") || normalized.includes("email rate limit")) {
    return "Es wurden gerade zu viele E-Mails versendet. Bitte warte ein paar Minuten und versuche es dann erneut.";
  }
  return message;
}

function authRedirectUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("auth", "recovery");
  url.searchParams.delete("v");
  url.hash = "";
  return url.toString();
}

function appRedirectUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("auth");
  url.searchParams.delete("type");
  url.searchParams.delete("code");
  url.searchParams.delete("v");
  url.hash = "";
  return url.toString();
}

function authCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("code");
}

function authTokensFromHash() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  return { access_token: accessToken, refresh_token: refreshToken };
}

function hasPasswordRecoveryParams() {
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return (
    params.get("auth") === "recovery" ||
    params.get("type") === "recovery" ||
    hashParams.get("type") === "recovery"
  );
}

function clearAuthUrlParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete("auth");
  url.searchParams.delete("type");
  url.searchParams.delete("code");
  url.hash = "";
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

async function openPasswordRecoveryFromUrl() {
  if (!supabaseClient || !hasPasswordRecoveryParams()) return false;

  const tokens = authTokensFromHash();
  if (tokens) {
    const { data, error } = await supabaseClient.auth.setSession(tokens);
    if (error) {
      const message = friendlyAuthError(error);
      els.authDialog.hidden = false;
      setAuthMode("login");
      setAuthMessage(`${message} Bitte fordere einen neuen Passwort-Link an.`, "error");
      setCloudStatus("Passwort-Link konnte nicht geöffnet werden.", "error");
      clearAuthUrlParams();
      return true;
    }
    currentUser = data.session?.user || data.user || currentUser;
  }

  const code = authCodeFromUrl();
  if (code) {
    const { data, error } = await supabaseClient.auth.exchangeCodeForSession(code);
    if (error) {
      const message = friendlyAuthError(error);
      els.authDialog.hidden = false;
      setAuthMode("login");
      setAuthMessage(`${message} Bitte fordere einen neuen Passwort-Link an.`, "error");
      setCloudStatus("Passwort-Link konnte nicht geöffnet werden.", "error");
      clearAuthUrlParams();
      return true;
    }
    currentUser = data.session?.user || data.user || currentUser;
  }

  const { data } = await supabaseClient.auth.getSession();
  currentUser = data.session?.user || currentUser;
  if (!currentUser) {
    els.authDialog.hidden = false;
    setAuthMode("login");
    setAuthMessage("Der Passwort-Link ist abgelaufen. Bitte fordere einen neuen Link an.", "error");
    setCloudStatus("Passwort-Link ist abgelaufen.", "error");
    clearAuthUrlParams();
    return true;
  }

  await loadCurrentProfile();
  updateAuthView();
  enterPasswordRecoveryMode();
  clearAuthUrlParams();
  return true;
}

function updateAuthView() {
  const hasSession = hasCachedAuthSession();
  const isSignedIn = Boolean(supabaseClient && (currentUser || hasSession));
  document.body.classList.toggle("is-signed-in", isSignedIn);
  document.body.classList.toggle("is-signed-out", !isSignedIn);
  updateEditAvailability();
  els.accountSignedOut.hidden = isSignedIn;
  els.cloudActions.hidden = !isSignedIn;
  els.signedOutMenu.hidden = isSignedIn;
  els.signedInMenu.hidden = !isSignedIn;
  const metadataName = currentUser?.user_metadata?.display_name || "";
  els.profileNameInput.value = isSignedIn ? currentProfile?.display_name || metadataName || "" : "";
  if (!isSignedIn) {
    if (els.profilePasswordInput) els.profilePasswordInput.value = "";
    if (els.profilePasswordConfirmInput) els.profilePasswordConfirmInput.value = "";
  }
  if (isSignedIn) {
    const displayName = currentProfile?.display_name || metadataName || currentUser?.email?.split("@")[0] || "Angemeldet";
    if (els.accountName) els.accountName.textContent = displayName;
    els.accountEmail.textContent = currentUser?.email || "Session wird geladen";
    if (els.profileEmailInput) els.profileEmailInput.value = currentUser?.email || "";
    els.accountAvatar.textContent = initials(displayName);
    if (els.accountMenuAvatar) els.accountMenuAvatar.textContent = initials(displayName);
  } else {
    if (els.accountName) els.accountName.textContent = "Konto";
    els.accountEmail.textContent = "Einloggen";
    if (els.profileEmailInput) els.profileEmailInput.value = "";
    els.accountAvatar.textContent = "";
    els.accountAvatar.setAttribute("aria-label", "Konto öffnen");
    if (els.accountMenuAvatar) els.accountMenuAvatar.textContent = "";
    els.userMenu.open = false;
  }
  if (!supabaseClient) {
    setCloudStatus("Speichern ist gerade nicht verfügbar. Prüfe bitte Verbindung und Konfiguration.", "error");
    return;
  }
  if (isSignedIn) {
    const toastName = accountToastName();
    setCloudStatus(currentUser ? (cloudSyncEnabled ? `Automatisches Speichern aktiv für ${toastName}.` : `Angemeldet als ${toastName}.`) : "Angemeldet. Session wird geladen.", "online");
    if (!authRecoveryMode) closeAuthDialog();
  } else {
    setCloudStatus("Du bist nicht eingeloggt. Deine Listen bleiben auf diesem Gerät.", "local");
    if (!localModeToastShown) {
      localModeToastShown = true;
      showLocalModeToast();
    }
  }
}

function initials(name) {
  return String(name || "HN")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase() || "")
    .join("") || "HN";
}

function openAuthDialog() {
  setAuthMode("login");
  setAuthMessage("");
  els.authDialog.hidden = false;
  window.setTimeout(() => els.authEmailInput.focus(), 0);
}

function closeAuthDialog() {
  els.authDialog.hidden = true;
}

function ensureCloudReady() {
  if (!supabaseClient) {
    setCloudStatus(authUnavailableMessage(), "error");
    return false;
  }
  if (!currentUser) {
    setCloudStatus("Bitte zuerst anmelden.", "error");
    return false;
  }
  return true;
}

async function loadCurrentProfile() {
  if (!supabaseClient || !currentUser) {
    currentProfile = null;
    updateAuthView();
    return;
  }

  const { data, error } = await withTimeout(
    supabaseClient.from("profiles").select("*").eq("id", currentUser.id).maybeSingle(),
    "Profil konnte gerade nicht geladen werden. Du bist trotzdem angemeldet."
  );
  if (error) {
    currentProfile = {
      id: currentUser.id,
      display_name: currentUser.user_metadata?.display_name || currentUser.email?.split("@")[0] || "Ich"
    };
    const friendsChanged = mergeAccountFriendsFromProfile();
    const linkedFriendsChanged = await loadFriendAccountsFromCloud();
    console.warn("Profil konnte nicht aus der Profiltabelle geladen werden.", error);
    const normalizedAssignments = renameProfileAssignments("Ich", currentProfile.display_name);
    updateAuthView();
    if (normalizedAssignments) commit();
    else {
      if (friendsChanged || linkedFriendsChanged) saveState(false);
      render();
    }
    return;
  }
  const metadataName = currentUser.user_metadata?.display_name || "";
  currentProfile = {
    ...(data || { id: currentUser.id }),
    display_name: data?.display_name || metadataName || currentUser.email?.split("@")[0] || "Ich"
  };
  const friendsChanged = mergeAccountFriendsFromProfile();
  const linkedFriendsChanged = await loadFriendAccountsFromCloud();
  const normalizedAssignments = renameProfileAssignments("Ich", currentProfile.display_name);
  updateAuthView();
  if (normalizedAssignments) commit();
  else {
    if (friendsChanged || linkedFriendsChanged) saveState(false);
    render();
  }
}

async function saveCurrentProfile() {
  if (!ensureCloudReady()) return;
  const previousDisplayName = profileDisplayName();
  const displayName = els.profileNameInput.value.trim();
  if (!displayName) {
    setCloudStatus("Bitte einen Anzeigenamen eingeben.", "error");
    els.profileNameInput.focus();
    return;
  }

  els.saveProfileButton.disabled = true;
  els.saveProfileButton.textContent = "Speichern...";
  try {
    if (currentUser) {
      currentUser.user_metadata = {
        ...(currentUser.user_metadata || {}),
        display_name: displayName
      };
    }
    const renamedAssignments = renameProfileAssignments(previousDisplayName, displayName);
    currentProfile = { id: currentUser.id, display_name: displayName };
    updateAuthView();
    if (renamedAssignments) commit();
    closeAccountSettings();
    els.userMenu.open = false;
    setCloudStatus(`Angemeldet als ${displayName}.`, "online");
    syncProfileNameToCloud(displayName).catch((error) => {
      console.warn("Profilname konnte nicht sofort in der Cloud gespeichert werden.", error);
    });
  } finally {
    els.saveProfileButton.disabled = false;
    els.saveProfileButton.textContent = "Profil speichern";
  }
}

async function syncProfileNameToCloud(displayName) {
  const { data: authData, error: authError } = await supabaseClient.auth.updateUser({
    data: { display_name: displayName }
  });
  if (authError) throwCloudError(authError);
  currentUser = authData?.user || currentUser;
  if (currentUser) {
    currentUser.user_metadata = {
      ...(currentUser.user_metadata || {}),
      display_name: displayName
    };
  }
  const { data, error } = await supabaseClient
    .from("profiles")
    .upsert({ id: currentUser.id, display_name: displayName }, { onConflict: "id" })
    .select()
    .single();
  if (error) {
    console.warn("Profil wurde im Login-Profil gespeichert, profiles-Tabelle ist nicht beschreibbar.", error);
    return;
  }
  currentProfile = data || currentProfile;
}

async function changeAccountEmail() {
  if (!ensureCloudReady()) return;
  const email = els.profileEmailInput.value.trim();
  if (!email || email === currentUser.email) {
    setCloudStatus("Bitte eine neue E-Mail-Adresse eingeben.", "error");
    return;
  }
  els.changeEmailButton.disabled = true;
  els.changeEmailButton.textContent = "Speichern...";
  const { data, error } = await supabaseClient.auth.updateUser({ email });
  els.changeEmailButton.disabled = false;
  els.changeEmailButton.textContent = "E-Mail ändern";
  if (error) {
    const message = friendlyAuthError(error);
    setCloudStatus(message, "error");
    return;
  }
  currentUser = data?.user || currentUser;
  updateAuthView();
  setCloudStatus("E-Mail-Änderung angefragt. Bitte bestätige sie im Postfach.", "online");
}

async function changeAccountPassword() {
  if (!ensureCloudReady()) return;
  const password = els.profilePasswordInput.value || "";
  const confirmPassword = els.profilePasswordConfirmInput.value || "";
  if (password.length < 6) {
    setCloudStatus("Bitte ein Passwort mit mindestens 6 Zeichen eingeben.", "error");
    els.profilePasswordInput.focus();
    return;
  }
  if (password !== confirmPassword) {
    setCloudStatus("Die beiden Passwörter stimmen nicht überein.", "error");
    els.profilePasswordConfirmInput.focus();
    return;
  }
  els.changePasswordButton.disabled = true;
  els.changePasswordButton.textContent = "Speichern...";
  const { error } = await supabaseClient.auth.updateUser({ password });
  els.changePasswordButton.disabled = false;
  els.changePasswordButton.textContent = "Passwort speichern";
  if (error) {
    const message = friendlyAuthError(error);
    setCloudStatus(message, "error");
    return;
  }
  els.profilePasswordInput.value = "";
  els.profilePasswordConfirmInput.value = "";
  setCloudStatus("Passwort gespeichert.", "online");
}

async function sendProfilePasswordReset() {
  if (!ensureCloudReady()) return;
  const email = currentUser.email;
  if (!email) return;
  els.profileResetPasswordButton.disabled = true;
  els.profileResetPasswordButton.textContent = "Sende Link...";
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectUrl()
  });
  els.profileResetPasswordButton.disabled = false;
  els.profileResetPasswordButton.textContent = "Passwort zurücksetzen";
  if (error) {
    const message = friendlyAuthError(error);
    setCloudStatus(message, "error");
    return;
  }
  setCloudStatus("Passwort-Link wurde an deine E-Mail gesendet.", "online");
  els.userMenu.open = false;
}

async function installApp() {
  if (!deferredInstallPrompt) {
    updateInstallAppControl();
    const message = isIosDevice()
      ? "Auf dem iPhone: Safari öffnen, Teilen antippen und „Zum Home-Bildschirm“ wählen."
      : "Öffne das Browser-Menü und wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“. Falls der Punkt fehlt, lade die Seite neu.";
    setCloudStatus(message, "local");
    return;
  }
  await deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  if (choice?.outcome === "accepted") deferredInstallPrompt = null;
  updateInstallAppControl();
}

async function deleteCurrentAccount() {
  if (!ensureCloudReady()) return;
  const confirmation = window.prompt('Diese Aktion löscht dein Konto und deine Cloud-Daten dauerhaft. Gib "KONTO LÖSCHEN" ein:');
  if (confirmation !== "KONTO LÖSCHEN") {
    setCloudStatus("Kontolöschung abgebrochen.", "local");
    return;
  }
  els.deleteAccountButton.disabled = true;
  els.deleteAccountButton.textContent = "Konto wird gelöscht...";
  try {
    const { error } = await supabaseClient.rpc("delete_current_user", { confirm_text: confirmation });
    if (error) {
      if (isMissingCloudFieldError(error) || error.code === "PGRST202") {
        setCloudStatus("Kontolöschung benötigt das aktuelle Supabase-Schema.", "error");
        return;
      }
      setCloudStatus(friendlyCloudError(error, "Konto konnte nicht gelöscht werden."), "error");
      return;
    }
    stopCloudSync();
    currentUser = null;
    currentProfile = null;
    localStorage.removeItem(storageKey);
    state = structuredClone(starterState);
    closeAccountSettings();
    updateAuthView();
    render();
    setCloudStatus("Konto und Cloud-Daten wurden gelöscht.", "local");
  } finally {
    els.deleteAccountButton.disabled = false;
    els.deleteAccountButton.textContent = "Konto dauerhaft löschen";
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMissingCloudFieldError(error) {
  const message = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  return error.code === "PGRST204" || message.includes("could not find") || message.includes("schema cache");
}

function normalizeIdsForCloud() {
  const tripIdMap = new Map();
  const globalIdMap = new Map();
  const itemIdMap = new Map();

  actualTrips().forEach((trip) => {
    if (!isUuid(trip.id)) {
      tripIdMap.set(trip.id, crypto.randomUUID());
      trip.id = tripIdMap.get(trip.id);
    }
    trip.activity = (trip.activity || []).map(normalizeActivityEntry);
    trip.smartContext = normalizeSmartContext(trip.smartContext);
    trip.meals ||= [];
    trip.items.forEach((item) => {
      if (!isUuid(item.id)) {
        itemIdMap.set(item.id, crypto.randomUUID());
        item.id = itemIdMap.get(item.id);
      }
    });
    trip.meals.forEach((meal) => {
      meal.id ||= crypto.randomUUID();
      meal.ingredients ||= [];
      meal.ingredients.forEach((ingredient) => {
        if (itemIdMap.has(ingredient.itemId)) ingredient.itemId = itemIdMap.get(ingredient.itemId);
      });
    });
  });

  state.globalItems.forEach((item) => {
    if (!isUuid(item.id)) {
      globalIdMap.set(item.id, crypto.randomUUID());
      item.id = globalIdMap.get(item.id);
    }
  });

  state.mealTemplates ||= [];
  state.mealTemplates.forEach((template) => {
    if (!isUuid(template.id)) template.id = crypto.randomUUID();
  });

  if (tripIdMap.has(state.activeTripId)) {
    state.activeTripId = tripIdMap.get(state.activeTripId);
  }
}

async function uploadStateToCloud() {
  if (!ensureCloudReady()) return;
  if (!navigator.onLine) {
    pendingCloudSave = true;
    setCloudStatus("Offline gespeichert. Wird automatisch synchronisiert, sobald du online bist.", "local");
    return;
  }
  normalizeIdsForCloud();
  cloudIsSaving = true;
  const uploadedMutationVersion = cloudMutationVersion;
  setCloudStatus("Speichere deine Listen...", "online");

  const cloudTrips = actualTrips();
  const existingCloudTripIds = await getExistingCloudTripIds();
  const trips = cloudTrips.map((trip) => ({
    id: trip.id,
    ...(!existingCloudTripIds.has(trip.id) ? { owner_id: currentUser.id } : {}),
    name: trip.name,
    destination: trip.destination || "",
    dates: trip.dates || "",
    start_date: trip.startDate || null,
    end_date: trip.endDate || null,
    travel_method: trip.travelMethod || "",
    activities: trip.activities || [],
    smart_context: normalizeSmartContext(trip.smartContext),
    completed: Boolean(trip.completed),
    meals: trip.meals || []
  }));

  const globalItems = state.globalItems.map((item) => ({
    id: item.id,
    owner_id: currentUser.id,
    name: item.name,
    category: item.category
  }));

  const tripItems = cloudTrips.flatMap((trip) =>
    trip.items.map((item) => ({
      id: item.id,
      trip_id: trip.id,
      name: item.name,
      category: item.category,
      assignee_name: item.assignee || "",
      packed: item.packed,
      missing: item.missing,
      shopping: item.shopping,
      bought: item.bought || false,
      quantity: item.quantity || "",
      note: item.note || "",
      item_group: item.group || "",
      created_by: currentUser.id
    }))
  );

  const mealTemplateRows = (state.mealTemplates || []).map((template) => ({
    id: isUuid(template.id) ? template.id : crypto.randomUUID(),
    owner_id: currentUser.id,
    name: template.name,
    ingredients: template.ingredients || []
  }));

  const activityRows = cloudTrips.flatMap((trip) =>
    (trip.activity || []).map(normalizeActivityEntry).map((entry) => ({
      id: entry.id,
      trip_id: trip.id,
      actor_id: currentUser.id,
      message: entry.message
    }))
  );

  const { error: tripsError } = await supabaseClient.from("trips").upsert(trips, { onConflict: "id" });
  if (tripsError && isMissingCloudFieldError(tripsError)) {
    const fallbackTrips = trips.map(({ meals, start_date, end_date, travel_method, activities, smart_context, ...trip }) => trip);
    const retry = await supabaseClient.from("trips").upsert(fallbackTrips, { onConflict: "id" });
    if (retry.error) throwCloudError(retry.error);
    setCloudStatus("Cloud gespeichert. Gerichte werden vollständig synchronisiert, sobald das neue SQL ausgeführt wurde.", "online");
  } else if (tripsError) throwCloudError(tripsError);

  for (const trip of cloudTrips) {
    if (trip.ownerId && trip.ownerId !== currentUser.id) continue;
    const friendIds = Array.from(new Set((trip.friendIds || []).filter(isUuid)));
    const { error } = await supabaseClient.rpc("sync_trip_friends", {
      target_trip_id: trip.id,
      friend_user_ids: friendIds
    });
    if (error && !isMissingCloudFieldError(error) && error.code !== "PGRST202") throwCloudError(error);
  }

  if (globalItems.length) {
    const { error } = await supabaseClient.from("global_items").upsert(globalItems, { onConflict: "id" });
    if (error) throwCloudError(error);
  }

  const cloudTripIds = cloudTrips.map((trip) => trip.id);
  if (cloudTripIds.length) {
    const { error } = await supabaseClient.from("trip_items").delete().in("trip_id", cloudTripIds);
    if (error) throwCloudError(error);
  }

  if (tripItems.length) {
    const { error } = await supabaseClient.from("trip_items").insert(tripItems);
    if (error && isMissingCloudFieldError(error)) {
      const fallbackItems = tripItems.map(({ item_group, ...item }) => item);
      const retry = await supabaseClient.from("trip_items").insert(fallbackItems);
      if (retry.error) throwCloudError(retry.error);
      setCloudStatus("Cloud gespeichert. Unterteilungen werden gespeichert, sobald das neue SQL ausgeführt wurde.", "online");
    } else if (error) throwCloudError(error);
  }

  if (mealTemplateRows.length) {
    const deleteTemplates = await supabaseClient.from("meal_templates").delete().eq("owner_id", currentUser.id);
    if (!deleteTemplates.error) {
      const { error } = await supabaseClient.from("meal_templates").upsert(mealTemplateRows, { onConflict: "id" });
      if (error && !isMissingCloudFieldError(error)) throwCloudError(error);
    } else if (!isMissingCloudFieldError(deleteTemplates.error)) {
      throwCloudError(deleteTemplates.error);
    }
  }

  if (cloudTripIds.length) {
    const { error } = await supabaseClient.from("activity").delete().in("trip_id", cloudTripIds);
    if (error) throwCloudError(error);
  }

  if (activityRows.length) {
    const { error } = await supabaseClient.from("activity").insert(activityRows);
    if (error) throwCloudError(error);
  }

  cloudTrips.forEach((trip) => {
    if (!trip.ownerId) trip.ownerId = currentUser.id;
    if (!trip.currentUserRole) trip.currentUserRole = "owner";
  });
  saveState();
  cloudIsSaving = false;
  cloudSyncEnabled = true;
  ignoreCloudChangesUntil = Date.now() + 2200;
  pendingCloudReload = false;
  subscribeToCloudChanges();
  if (cloudMutationVersion > uploadedMutationVersion) {
    pendingCloudSave = true;
    scheduleCloudSave();
    return;
  }
  pendingCloudSave = false;
}

async function loadStateFromCloud(successMessage = "Daten geladen.") {
  if (!ensureCloudReady()) return;
  cloudIsLoading = true;
  setCloudStatus("Lade deine gespeicherten Listen...", "online");
  const previousActiveTripId = state.activeTripId;
  const previousFriends = normalizeFriendList(state.friends || []);
  const previousFriendAccounts = normalizeFriendAccounts(state.friendAccounts || []);
  const localMealsByTripId = new Map(state.trips.map((trip) => [trip.id, trip.meals || []]));
  const localTripDetailsById = new Map(state.trips.map((trip) => [trip.id, {
    travelMethod: trip.travelMethod || "",
    activities: trip.activities || [],
    smartContext: normalizeSmartContext(trip.smartContext)
  }]));

  const { data: trips, error: tripsError } = await withTimeout(
    supabaseClient.from("trips").select("*").order("created_at", { ascending: true }),
    "Reisen konnten gerade nicht geladen werden."
  );
  if (tripsError) throwCloudError(tripsError);

  const { data: globalItems, error: globalError } = await withTimeout(
    supabaseClient.from("global_items").select("*").order("created_at", { ascending: true }),
    "Vorlagen konnten gerade nicht geladen werden."
  );
  if (globalError) throwCloudError(globalError);

  const { data: cloudMealTemplates, error: mealTemplateError } = await withTimeout(
    supabaseClient
      .from("meal_templates")
      .select("*")
      .order("created_at", { ascending: false }),
    "Gerichte-Vorlagen konnten gerade nicht geladen werden."
  );
  if (mealTemplateError && !isMissingCloudFieldError(mealTemplateError)) throwCloudError(mealTemplateError);

  if (!trips.length) {
    cloudIsLoading = false;
    setCloudStatus("Noch keine gespeicherten Reisen gefunden. Du kannst deine aktuelle Liste speichern.", "online");
    return;
  }

  const tripIds = trips.map((trip) => trip.id);
  const { data: tripItems, error: itemsError } = await withTimeout(
    supabaseClient.from("trip_items").select("*").in("trip_id", tripIds).order("created_at", { ascending: true }),
    "Packlisten konnten gerade nicht geladen werden."
  );
  if (itemsError) throwCloudError(itemsError);

  const { data: activity, error: activityError } = await withTimeout(
    supabaseClient.from("activity").select("*").in("trip_id", tripIds).order("created_at", { ascending: false }),
    "Aktivitäten konnten gerade nicht geladen werden."
  );
  if (activityError) throwCloudError(activityError);

  const { data: members, error: membersError } = await withTimeout(
    supabaseClient.from("trip_members").select("*").in("trip_id", tripIds),
    "Mitreisende konnten gerade nicht geladen werden."
  );
  if (membersError) throwCloudError(membersError);

  const memberUserIds = Array.from(new Set(members.map((member) => member.user_id)));
  const { data: profiles, error: profilesError } = memberUserIds.length ?
     await withTimeout(
       supabaseClient.from("profiles").select("*").in("id", memberUserIds),
       "Profile konnten gerade nicht geladen werden."
     )
    : { data: [], error: null };
  if (profilesError) throwCloudError(profilesError);
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

  const cloudTripIds = new Set(trips.map((trip) => trip.id));
  state = {
    activeTripId: cloudTripIds.has(previousActiveTripId) ? previousActiveTripId : trips[0].id,
    customTemplates: state.customTemplates || [],
    mealTemplates: mealTemplateError ?
       state.mealTemplates || []
      : (cloudMealTemplates || []).map((template) => ({
          id: template.id,
          name: template.name,
          note: "",
          ingredients: Array.isArray(template.ingredients) ? template.ingredients : []
        })),
    friends: previousFriends,
    friendAccounts: previousFriendAccounts,
    globalItems: globalItems.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category
    })),
    trips: trips.map((trip) => {
      const items = tripItems
        .filter((item) => item.trip_id === trip.id)
        .map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          assignee: item.assignee_name || "",
          packed: item.packed,
          missing: item.missing,
          shopping: item.shopping,
          bought: item.bought || false,
          quantity: item.quantity || "",
          note: item.note || "",
          group: item.item_group || ""
        }));
      const assignees = items.map((item) => item.assignee).filter(Boolean);
      const tripMemberRows = members.filter((member) => member.trip_id === trip.id);
      const friendMemberRows = tripMemberRows.filter((member) => member.role === "member" && member.user_id !== currentUser.id);
      const memberNames = friendMemberRows
        .map((member) => profilesById.get(member.user_id)?.display_name || "Mitreisende Person");
      const localDetails = localTripDetailsById.get(trip.id) || {};
      return {
        id: trip.id,
        name: trip.name,
        destination: trip.destination,
        dates: trip.dates,
        startDate: trip.start_date || "",
        endDate: trip.end_date || "",
        travelMethod: trip.travel_method || localDetails.travelMethod || "",
        activities: Array.isArray(trip.activities) ? trip.activities : localDetails.activities || [],
        smartContext: normalizeSmartContext(trip.smart_context || localDetails.smartContext),
        ownerId: trip.owner_id,
        currentUserRole: tripMemberRows.find((member) => member.user_id === currentUser.id)?.role || "",
        createdAt: trip.created_at || new Date().toISOString(),
        completed: Boolean(trip.completed),
        friendIds: friendMemberRows.map((member) => member.user_id),
        people: Array.from(new Set([currentProfile?.display_name || profileDisplayName() || "Ich", ...memberNames, ...assignees])),
        activity: activity.filter((entry) => entry.trip_id === trip.id).map((entry) => ({ id: entry.id, message: entry.message })),
        meals: Array.isArray(trip.meals) ? trip.meals : localMealsByTripId.get(trip.id) || [],
        items
      };
    })
  };

  saveState();
  render();
  cloudSyncEnabled = true;
  cloudIsLoading = false;
  subscribeToCloudChanges();
  setCloudStatus(successMessage, "online");
  if (pendingCloudReload) {
    pendingCloudReload = false;
    scheduleCloudReload();
  }
}

async function getExistingCloudTripIds() {
  const ids = actualTrips().filter((trip) => isUuid(trip.id)).map((trip) => trip.id);
  if (!ids.length) return new Set();
  const { data, error } = await supabaseClient.from("trips").select("id").in("id", ids);
  if (error) throwCloudError(error);
  return new Set(data.map((trip) => trip.id));
}

function scheduleCloudSave() {
  if (!cloudSyncEnabled || !currentUser) return;
  if (cloudIsSaving || cloudIsLoading) {
    pendingCloudSave = true;
    return;
  }
  if (!navigator.onLine) {
    pendingCloudSave = true;
    setCloudStatus("Offline gespeichert. Wird automatisch synchronisiert, sobald du online bist.", "local");
    return;
  }
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(() => {
    uploadStateToCloud()
      .then(() => {
        pendingCloudSave = false;
        setCloudStatus("Änderungen gespeichert.", "online");
      })
      .catch((error) => console.error(error));
  }, 1600);
}

function scheduleCloudReload() {
  if (!cloudSyncEnabled || !currentUser) return;
  if (Date.now() < ignoreCloudChangesUntil) return;
  if (cloudIsSaving || cloudIsLoading) {
    pendingCloudReload = true;
    return;
  }
  window.clearTimeout(cloudReloadTimer);
  cloudReloadTimer = window.setTimeout(() => {
    loadStateFromCloud("Änderungen synchronisiert.").catch((error) => console.error(error));
  }, 700);
}

function subscribeToCloudChanges() {
  if (!supabaseClient || !currentUser || cloudChannel) return;
  cloudChannel = supabaseClient
    .channel("holiday-notes-live-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, scheduleCloudReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "trip_members" }, scheduleCloudReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "global_items" }, scheduleCloudReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "trip_items" }, scheduleCloudReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "activity" }, scheduleCloudReload)
    .subscribe();
}

function stopCloudSync() {
  cloudSyncEnabled = false;
  pendingCloudReload = false;
  pendingCloudSave = false;
  window.clearTimeout(cloudSaveTimer);
  window.clearTimeout(cloudReloadTimer);
  if (cloudChannel) {
    supabaseClient.removeChannel(cloudChannel);
    cloudChannel = null;
  }
}

async function logout() {
  stopCloudSync();
  currentUser = null;
  currentProfile = null;
  cloudSyncEnabled = false;
  els.userMenu.open = false;
  closeAuthDialog();
  updateAuthView();
  setCloudStatus("Du bist abgemeldet. Deine Listen bleiben auf diesem Gerät.", "local");
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut({ scope: "local" });
  if (error) {
    console.warn("Abmelden bei Supabase konnte nicht vollständig bestätigt werden.", error);
  }
}

async function leaveActiveTrip() {
  if (!requireSignedInForEdit()) return;
  const trip = activeTrip();
  if (!trip) return;
  const isCloudOwner = Boolean(currentUser && trip.ownerId === currentUser.id);
  if (isCloudOwner) {
    setCloudStatus("Du bist Besitzer dieser Reise. Eigene Reisen kannst du in der Reisebearbeitung löschen.", "error");
    openManageTripDialog(trip.id);
    return;
  }
  const confirmText = currentUser ?
     `Möchtest du "${trip.name}" wirklich verlassen? Die Reise bleibt für andere Mitreisende erhalten.`
    : `Möchtest du "${trip.name}" von diesem Gerät entfernen?`;
  if (!window.confirm(confirmText)) return;
  if (currentUser && supabaseClient && isUuid(trip.id)) {
    setCloudStatus("Verlasse Reise...", "online");
    const { error } = await supabaseClient
      .from("trip_members")
      .delete()
      .eq("trip_id", trip.id)
      .eq("user_id", currentUser.id);
    if (error) {
      const message = error.code === "42501" ?
         "Reise konnte nicht verlassen werden. Bitte führe die neue Supabase-Regel aus."
        : error.message || "Reise konnte nicht verlassen werden.";
      setCloudStatus(message, "error");
      return;
    }
  }
  removeTripLocally(trip.id);
  setCloudStatus("Reise verlassen.", currentUser ? "online" : "local");
  activateView("manage");
}

function throwCloudError(error) {
  cloudIsSaving = false;
  cloudIsLoading = false;
  pendingCloudReload = false;
  setCloudStatus(friendlyCloudError(error, "Cloud gerade nicht erreichbar. Deine Listen bleiben lokal gespeichert."), "error");
  throw error;
}

async function initCloud() {
  try {
    await initializeSupabaseClient();
    updateAuthView();
    if (!supabaseClient) return;

    const recoveryHandled = await openPasswordRecoveryFromUrl();
    const { data } = await supabaseClient.auth.getSession();
    currentUser = data.session?.user || null;
    if (currentUser) await loadCurrentProfile();
    updateAuthView();
  } catch (error) {
    console.warn("Cloud-Start fehlgeschlagen.", error);
    currentUser = null;
    currentProfile = null;
    stopCloudSync();
    updateAuthView();
    setCloudStatus(friendlyCloudError(error), "error");
  }

  if (!supabaseClient) return;
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    try {
      if (event === "INITIAL_SESSION") return;
      currentUser = session?.user || null;
      if (!currentUser) {
        currentProfile = null;
        stopCloudSync();
      } else {
        await loadCurrentProfile();
      }
      updateAuthView();
      if (event === "PASSWORD_RECOVERY" || (hasPasswordRecoveryParams() && currentUser)) {
        enterPasswordRecoveryMode();
        clearAuthUrlParams();
      }
    } catch (error) {
      console.warn("Auth-Status konnte nicht aktualisiert werden.", error);
      setCloudStatus(friendlyCloudError(error), "error");
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

els.createTripButton.addEventListener("click", openNewTripDialog);
els.packEmptyTripLink?.addEventListener("click", openNewTripDialog);
els.homeButton.addEventListener("click", () => {
  closeNewTripDialog();
  closeManageTripDialog();
  closeTripFriendsDialog();
  closeTripPicker();
  closeFilterDialog();
  closeShoppingFilterDialog();
  closeItemDialog();
  closeItemSettingsDialog();
  closeAccountSettings();
  closeAuthDialog();
  activateView("pack");
  window.history.replaceState({}, "", window.location.pathname);
});
els.closeNewTripButton.addEventListener("click", closeNewTripDialog);
els.newTripBackdrop.addEventListener("click", closeNewTripDialog);
els.newTripForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createTripFromDialog();
});
els.closeManageTripButton.addEventListener("click", closeManageTripDialog);
els.manageTripBackdrop.addEventListener("click", closeManageTripDialog);
els.manageTripForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveManageTripDialog();
});
[
  els.manageDialogTripIcon,
  els.manageDialogTripName,
  els.manageDialogTripDestination,
  els.manageDialogTripAccommodation,
  els.manageDialogTripLuggage,
  els.manageDialogTripInternational,
  els.manageDialogTripChildren,
  els.manageDialogTripPet
].filter(Boolean).forEach((control) => {
  control.addEventListener("input", scheduleManageTripAutosave);
  control.addEventListener("change", scheduleManageTripAutosave);
});
[els.manageDialogTripStart, els.manageDialogTripDurationDays].forEach((input) => {
  input.addEventListener("input", () => {
    updateManageDialogDuration();
    scheduleManageTripAutosave();
  });
});
els.manageDialogOpenPackButton.addEventListener("click", () => {
  if (!requireSignedInForEdit()) return;
  const trip = state.trips.find((entry) => entry.id === editingManageTripId);
  if (trip) state.activeTripId = trip.id;
  closeManageTripDialog();
  commit();
  activateView("people");
});
els.manageDialogCompleteButton.addEventListener("click", () => {
  const tripId = editingManageTripId;
  closeManageTripDialog();
  toggleTripCompleted(tripId);
});
els.manageDialogDeleteButton.addEventListener("click", () => {
  const tripId = editingManageTripId;
  closeManageTripDialog();
  deleteTrip(tripId).catch((error) => console.error(error));
});
els.newTripIconButtons.forEach((button) => {
  button.addEventListener("click", () => setNewTripIcon(button.dataset.icon || ""));
});
els.newTripTravelMethodButtons.forEach((button) => {
  button.addEventListener("click", () => setTravelMethod("new", button.dataset.method || ""));
});
els.manageDialogTripTravelMethodButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setTravelMethod("manage", button.dataset.method || "");
    scheduleManageTripAutosave();
  });
});
[els.newTripStartInput, els.newTripDurationDaysInput].forEach((input) => {
  input.addEventListener("input", updateNewTripDuration);
});
els.addNewTripActivityButton.addEventListener("click", () => addActivityDraft("new"));
els.newTripActivityInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addActivityDraft("new");
});
els.newTripActivityList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-activity-index]");
  if (!button) return;
  removeActivityDraft("new", Number(button.dataset.activityIndex));
});
els.addManageTripActivityButton.addEventListener("click", () => {
  addActivityDraft("manage");
  scheduleManageTripAutosave();
});
els.manageDialogTripActivityInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addActivityDraft("manage");
  scheduleManageTripAutosave();
});
els.manageDialogTripActivityList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-activity-index]");
  if (!button) return;
  removeActivityDraft("manage", Number(button.dataset.activityIndex));
  scheduleManageTripAutosave();
});
els.closeTripPickerButton.addEventListener("click", closeTripPicker);
els.tripPickerBackdrop.addEventListener("click", closeTripPicker);
els.newTripFromPickerButton.addEventListener("click", openNewTripDialog);
els.editActiveTripFromPickerButton.addEventListener("click", () => {
  const tripId = state.activeTripId;
  closeTripPicker();
  openManageTripDialog(tripId);
});
els.closeItemDialogButton.addEventListener("click", closeItemDialog);
els.itemDialogBackdrop.addEventListener("click", closeItemDialog);
els.itemDialogForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveItemFromDialog();
});
els.itemDialogNameInput.addEventListener("input", updateItemDialogCategoryHint);
els.itemDialogCategorySelect.addEventListener("input", () => {
  els.itemDialogGroupInput.value = estimateItemGroup(els.itemDialogNameInput.value.trim(), els.itemDialogCategorySelect.value);
});
if (els.itemDialogAssigneeButtons) {
  els.itemDialogAssigneeButtons.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-assignee]");
    if (!button) return;
    els.itemDialogAssigneeSelect.value = button.dataset.assignee || defaultAssignee();
    renderItemDialogAssigneeButtons();
  });
}
els.closeItemSettingsButton.addEventListener("click", closeItemSettingsDialog);
els.itemSettingsBackdrop.addEventListener("click", closeItemSettingsDialog);
els.itemSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveItemSettingsDialog();
});
els.settingsItemCategorySelect.addEventListener("input", () => {
  if (!els.settingsItemGroupInput.value.trim()) {
    els.settingsItemGroupInput.value = estimateItemGroup(els.settingsItemNameInput.value.trim(), els.settingsItemCategorySelect.value);
  }
});
document.querySelectorAll(".group-chip-row").forEach((row) => {
  row.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-group]");
    if (!button) return;
    const input = document.querySelector(`#${row.dataset.target}`);
    if (!input) return;
    input.value = button.dataset.group || "";
    input.focus();
  });
});
els.deleteItemSettingsButton.addEventListener("click", deleteCurrentItemFromSettings);
els.mealTemplateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addMealTemplateFromForm();
});
els.mealTemplateSearchInput.addEventListener("input", renderMealTemplateOptions);
els.mealTemplateSelect.addEventListener("input", () => {
  renderMealTemplatePreview(availableMealTemplates().find((entry) => entry.id === els.mealTemplateSelect.value));
});
els.mealDialogTemplateSearchInput.addEventListener("input", renderMealDialogTemplateOptions);
els.mealDialogTemplateSelect.addEventListener("input", () => {
  renderMealDialogTemplatePreview(availableMealTemplates().find((entry) => entry.id === els.mealDialogTemplateSelect.value));
  useMealTemplateInDialog();
});
els.useMealDialogTemplateButton.addEventListener("click", useMealTemplateInDialog);
els.mealNameInput.addEventListener("input", () => {
  renderMealDialogTemplateOptions();
  updateMealDialogProgressiveFields();
  scheduleMealDialogAutosave();
});
els.snackQuantityInput?.addEventListener("input", scheduleMealDialogAutosave);
els.foodModeButtons.forEach((button) => {
  button.addEventListener("click", () => setFoodMode(button.dataset.foodMode));
});
els.mealKindButtons.forEach((button) => {
  button.addEventListener("click", () => setMealKind(button.dataset.mealKind));
});
els.shoppingModeButtons.forEach((button) => {
  button.addEventListener("click", () => setShoppingMode(button.dataset.shoppingMode));
});
els.shoppingStatusButtons.forEach((button) => {
  button.addEventListener("click", () => setShoppingStatus(button.dataset.shoppingStatus));
});
els.shoppingSearchInput?.addEventListener("input", () => {
  updateShoppingFilterToggleState();
  renderShoppingItems(activeTrip());
});
els.toggleShoppingFilterButton?.addEventListener("click", openShoppingFilterDialog);
els.closeShoppingFilterButton?.addEventListener("click", closeShoppingFilterDialog);
els.shoppingFilterBackdrop?.addEventListener("click", closeShoppingFilterDialog);
els.resetShoppingFilterButton?.addEventListener("click", resetShoppingFilters);
if (els.quickAddShoppingButton) {
  els.quickAddShoppingButton.addEventListener("click", () => openItemDialog("", {
    mode: "food",
    category: "Nahrung",
    group: "Lebensmittel",
    shopping: true
  }));
}
els.addMealDialogFoodIngredientButton.addEventListener("click", addFoodIngredientFromMealDialog);
els.mealForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addMealFromForm();
});
els.createMealButton.addEventListener("click", () => openMealDialog(null, { date: selectedMealDate || "", type: mealKind }));
els.editSelectedMealButton?.remove();
els.repeatSelectedMealButton.addEventListener("click", repeatSelectedMeal);
els.deleteSelectedMealButton.addEventListener("click", deleteSelectedMeal);
els.deleteMealDialogButton.addEventListener("click", () => {
  if (!editingMealId) return;
  deleteMealById(editingMealId);
});
els.closeMealButton.addEventListener("click", closeMealDialog);
els.mealDialogBackdrop.addEventListener("click", closeMealDialog);
els.addMealIngredientButton.addEventListener("click", openMealIngredientDialog);
els.closeMealIngredientButton.addEventListener("click", closeMealIngredientDialog);
els.mealIngredientBackdrop.addEventListener("click", closeMealIngredientDialog);
els.mealIngredientNameInput.addEventListener("input", renderIngredientSuggestionOptions);
els.mealIngredientSuggestionSelect.addEventListener("input", useIngredientSuggestion);
els.mealIngredientForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addPendingMealIngredientFromDialog();
});
els.foodIngredientForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addFoodIngredientFromForm();
});


els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activateView(tab.dataset.view);
  });
});

let viewSwipeStart = null;

document.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  if (!swipeViewOrder.includes(currentView)) return;
  if (event.target.closest("input, select, textarea, button, a, summary, [contenteditable='true'], .sidebar, .tabs, .category-carousel, .meal-day-carousel, .trip-dialog, .auth-dialog")) return;
  viewSwipeStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    time: Date.now()
  };
});

document.addEventListener("pointerup", (event) => {
  if (!viewSwipeStart || event.pointerId !== viewSwipeStart.pointerId) return;
  const deltaX = event.clientX - viewSwipeStart.x;
  const deltaY = event.clientY - viewSwipeStart.y;
  const elapsed = Date.now() - viewSwipeStart.time;
  viewSwipeStart = null;
  if (elapsed > 700 || Math.abs(deltaX) < 58 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;
  const currentIndex = swipeViewOrder.indexOf(currentView);
  const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
  if (nextIndex < 0 || nextIndex >= swipeViewOrder.length) return;
  activateView(swipeViewOrder[nextIndex], { direction: deltaX < 0 ? "right" : "left" });
});

document.addEventListener("pointercancel", () => {
  viewSwipeStart = null;
});

window.addEventListener("online", updateConnectionBanner);
window.addEventListener("offline", updateConnectionBanner);

[els.searchInput, els.categoryFilter, els.assigneeFilter].forEach((control) => control.addEventListener("input", render));

els.categoryPicker.addEventListener("click", (event) => {
  const button = event.target.closest(".category-chip");
  if (!button) return;
  els.categoryFilter.value = button.dataset.category || "all";
  if (categories.includes(els.categoryFilter.value)) activePackCategory = els.categoryFilter.value;
  shouldFocusPackSlide = true;
  renderCategoryPicker();
  render();
});

els.tripItems.addEventListener("scroll", () => {
  if (!els.tripItems.classList.contains("category-carousel")) return;
  updatePackSliderStatus();
}, { passive: true });


els.assigneePicker.addEventListener("click", (event) => {
  const button = event.target.closest(".assignee-chip");
  if (!button) return;
  els.assigneeFilter.value = button.dataset.assignee || "all";
  const people = Array.from(new Set([...(activeTrip().people || []), ...activeTrip().items.map((item) => item.assignee || "")].filter(Boolean)));
  renderAssigneePicker(people);
  render();
});

document.addEventListener("click", (event) => {
  const keepOpen = event.target.closest(".item-row, .trip-dialog, .auth-dialog");
  if (!keepOpen) closeExpandedItems();
});

els.filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setStatusFilter(button.dataset.status);
    closeFilterDialog();
    render();
  });
});

els.toggleFilterButton.addEventListener("click", () => {
  openFilterDialog();
});
els.closeFilterButton.addEventListener("click", closeFilterDialog);
els.filterBackdrop.addEventListener("click", closeFilterDialog);
els.resetFilterButton.addEventListener("click", resetPackFilters);

els.quickAddItemButton.addEventListener("click", () => {
  closeExpandedItems();
  openItemDialog("");
});
els.useTemplateFromItemButton.addEventListener("click", () => {
  closeItemDialog();
  openTemplatesArea();
});

els.addGlobalItemForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireSignedInForEdit()) return;
  const name = els.newGlobalItemInput.value.trim();
  if (!name) return;
  state.globalItems.push({ id: crypto.randomUUID(), name, category: els.newGlobalCategoryInput.value });
  els.newGlobalItemInput.value = "";
  addActivity(`${name} als globale Vorlage gespeichert`);
  commit();
});

els.saveTripTemplateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveActiveTripAsTemplate();
});
els.templateSearchInput.addEventListener("input", () => renderCustomTemplates(activeTrip()));

els.addMissingTemplatesButton.addEventListener("click", addMissingTemplatesToTrip);

els.addVacationTypeButton.addEventListener("click", addVacationTypeTemplates);

els.addPersonForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const friend = els.newPersonInput.value.trim();
  if (!friend) return;
  els.newPersonInput.value = "";
  const friendResult = await addFriendToAccount(friend);
  if (!friendResult?.accepted) return;
  const addedName = friendResult.name;
  const trip = activeTrip();
  trip.people = tripPeopleFromSelectedFriends([...(trip.people || []), addedName], trip);
  const linkedAccount = friendOptions().find((entry) => entry.name.toLowerCase() === addedName.toLowerCase() && entry.id);
  if (linkedAccount) trip.friendIds = Array.from(new Set([...(trip.friendIds || []), linkedAccount.id]));
  addActivityToTrip(trip, `${addedName} zur Reise hinzugefügt`);
  commit();
});

els.exportButton.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "holiday-notes-snapshot.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

els.importInput.addEventListener("change", async () => {
  if (!requireSignedInForEdit()) {
    els.importInput.value = "";
    return;
  }
  const file = els.importInput.files[0];
  if (!file) return;
  const imported = JSON.parse(await file.text());
  if (!imported.trips || !imported.globalItems) return;
  imported.customTemplates ||= [];
  imported.mealTemplates ||= [];
  state = imported;
  commit();
});

els.completeShoppingButton.addEventListener("click", completeShoppingList);
if (els.foodCompleteShoppingButton) els.foodCompleteShoppingButton.addEventListener("click", completeShoppingList);

els.openAuthButton.addEventListener("click", () => {
  els.userMenu.open = false;
  openAuthDialog();
});
mountAccountSettingsPanel();
updateInstallAppControl();
els.userMenuButton.addEventListener("click", (event) => {
  event.preventDefault();
  els.userMenu.open = false;
  if (currentUser) {
    openAccountSettings();
  } else {
    openAuthDialog();
  }
});
document.addEventListener("click", (event) => {
  if (els.userMenu.open && !els.userMenu.contains(event.target)) els.userMenu.open = false;
});
document.querySelectorAll("#peopleView > details.content-fold").forEach((fold) => {
  fold.addEventListener("toggle", () => {
    if (!fold.open) return;
    document.querySelectorAll("#peopleView > details.content-fold").forEach((other) => {
      if (other !== fold) other.open = false;
    });
  });
});
document.querySelectorAll(".team-account-panel > details.activity-fold").forEach((fold) => {
  fold.addEventListener("toggle", () => {
    if (!fold.open) return;
    document.querySelectorAll(".team-account-panel > details.activity-fold").forEach((other) => {
      if (other !== fold) other.open = false;
    });
  });
});
els.closeAuthButton.addEventListener("click", closeAuthDialog);
els.authBackdrop.addEventListener("click", closeAuthDialog);
els.closeAccountSettingsButton.addEventListener("click", closeAccountSettings);
els.accountSettingsBackdrop.addEventListener("click", closeAccountSettings);
els.installAppButton?.addEventListener("click", () => {
  installApp().catch((error) => setCloudStatus(friendlyCloudError(error, "App konnte nicht installiert werden."), "error"));
});
els.deleteAccountButton?.addEventListener("click", () => {
  deleteCurrentAccount().catch((error) => {
    console.error(error);
    setCloudStatus(friendlyCloudError(error, "Konto konnte nicht gelöscht werden."), "error");
  });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.authDialog.hidden) closeAuthDialog();
  if (event.key === "Escape" && !els.accountSettingsDialog.hidden) closeAccountSettings();
  if (event.key === "Escape" && !els.newTripDialog.hidden) closeNewTripDialog();
  if (event.key === "Escape" && !els.tripPickerDialog.hidden) closeTripPicker();
  if (event.key === "Escape" && !els.tripFriendsDialog?.hidden) closeTripFriendsDialog();
  if (event.key === "Escape" && !els.filterPanel.hidden) closeFilterDialog();
  if (event.key === "Escape" && !els.shoppingFilterPanel.hidden) closeShoppingFilterDialog();
  if (event.key === "Escape" && !els.itemDialog.hidden) closeItemDialog();
  if (event.key === "Escape" && !els.mealDialog.hidden) closeMealDialog();
  if (event.key === "Escape" && !els.mealIngredientDialog.hidden) closeMealIngredientDialog();
  if (event.key === "Escape" && !els.itemSettingsDialog.hidden) closeItemSettingsDialog();
});

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await initializeSupabaseClient();
  if (!supabaseClient) {
    setAuthMessage(authUnavailableMessage(), "error");
    return updateAuthView();
  }
  if (authRecoveryMode) {
    const password = els.authPasswordInput.value;
    const confirmPassword = els.authPasswordConfirmInput.value;
    if (password.length < 6) {
      setAuthMessage("Bitte ein neues Passwort mit mindestens 6 Zeichen eingeben.", "error");
      return;
    }
    if (password !== confirmPassword) {
      setAuthMessage("Die beiden Passwörter stimmen nicht überein.", "error");
      return;
    }
    setAuthMessage("Neues Passwort wird gespeichert...");
    els.loginButton.disabled = true;
    els.loginButton.textContent = "Speichere...";
    try {
      const { data, error } = await supabaseClient.auth.updateUser({ password });
      if (error) {
        const message = friendlyAuthError(error);
        setAuthMessage(message, "error");
        setCloudStatus(message, "error");
        return;
      }
      currentUser = data?.user || currentUser;
    } finally {
      els.loginButton.disabled = false;
      els.loginButton.textContent = "Neues Passwort speichern";
    }
    els.authPasswordInput.value = "";
    els.authPasswordConfirmInput.value = "";
    authRecoveryMode = false;
    setAuthMessage("Passwort gespeichert. Du bist jetzt angemeldet.", "success");
    window.setTimeout(closeAuthDialog, 900);
    updateAuthView();
    return;
  }
  const email = els.authEmailInput.value.trim();
  const password = els.authPasswordInput.value;
  if (!email || password.length < 6) {
    setAuthMessage("Bitte E-Mail und ein Passwort mit mindestens 6 Zeichen eingeben.", "error");
    return;
  }
  setAuthMessage("Login läuft...");
  setCloudStatus("Login läuft...", "local");
  els.loginButton.disabled = true;
  els.loginButton.textContent = "Einloggen...";
  try {
    const { data, error } = await withTimeout(
      supabaseClient.auth.signInWithPassword({ email, password }),
      "Login dauert zu lange. Bitte prüfe deine Verbindung und versuche es erneut."
    );
    if (error) {
      const message = friendlyAuthError(error);
      setAuthMessage(message, "error");
      setCloudStatus(message, "error");
      return;
    }
    currentUser = data.session?.user || data.user || null;
    els.authPasswordInput.value = "";
    setAuthMessage("Login erfolgreich.", "success");
    if (currentUser) {
      cloudSyncEnabled = true;
      subscribeToCloudChanges();
    }
    updateAuthView();
    closeAuthDialog();
    if (currentUser) {
      loadCurrentProfile()
        .then(() => loadStateFromCloud("Login erfolgreich. Deine gespeicherten Listen wurden geladen."))
        .catch((loadError) => {
          console.error(loadError);
          cloudIsLoading = false;
          setCloudStatus(friendlyCloudError(loadError, "Login erfolgreich. Cloud-Daten konnten gerade nicht geladen werden."), "error");
        });
    }
  } catch (loginError) {
    const message = friendlyAuthError(loginError);
    setAuthMessage(message, "error");
    setCloudStatus(message, "error");
  } finally {
    els.loginButton.disabled = false;
    els.loginButton.textContent = "Einloggen";
  }
});

els.signupButton.addEventListener("click", async () => {
  await initializeSupabaseClient();
  if (authMode !== "signup") {
    setAuthMode("signup");
    setAuthMessage("Gib für dein neues Konto bitte auch einen Anzeigenamen ein.");
    window.setTimeout(() => els.authDisplayNameInput.focus(), 0);
    return;
  }
  if (!supabaseClient) {
    setAuthMessage(authUnavailableMessage(), "error");
    return updateAuthView();
  }
  const email = els.authEmailInput.value.trim();
  const password = els.authPasswordInput.value;
  const confirmPassword = els.authPasswordConfirmInput.value;
  const displayName = els.authDisplayNameInput.value.trim();
  if (!email || password.length < 6) {
    setAuthMessage("Bitte E-Mail und ein Passwort mit mindestens 6 Zeichen eingeben.", "error");
    setCloudStatus("Bitte E-Mail und Passwort mit mindestens 6 Zeichen eingeben.", "error");
    return;
  }
  if (!displayName) {
    setAuthMessage("Bitte gib für ein neues Konto auch einen Anzeigenamen ein.", "error");
    return;
  }
  if (password !== confirmPassword) {
    setAuthMessage("Die beiden Passwörter stimmen nicht überein.", "error");
    return;
  }
  setAuthMessage("Konto wird erstellt...");
  setCloudStatus("Konto wird angelegt...", "local");
  const { error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: appRedirectUrl(),
      data: {
        display_name: displayName
      }
    }
  });
  if (error) {
    const message = friendlyAuthError(error);
    setAuthMessage(message, "error");
    setCloudStatus(message, "error");
    return;
  }
  els.authPasswordInput.value = "";
  els.authPasswordConfirmInput.value = "";
  els.authDisplayNameInput.value = "";
  setAuthMessage("Konto erstellt. Wenn eine E-Mail-Bestätigung nötig ist, bitte Postfach prüfen.", "success");
  setCloudStatus("Konto angelegt. Bitte melde dich nach der Bestätigung an.", "local");
});

els.backToLoginButton.addEventListener("click", () => {
  setAuthMode("login");
  setAuthMessage("");
});

els.togglePasswordButton.addEventListener("click", () => {
  const isHidden = els.authPasswordInput.type === "password";
  els.authPasswordInput.type = isHidden ? "text" : "password";
  els.togglePasswordButton.classList.toggle("active", isHidden);
  els.togglePasswordButton.setAttribute("aria-label", isHidden ? "Passwort verbergen" : "Passwort anzeigen");
  els.togglePasswordButton.setAttribute("title", isHidden ? "Passwort verbergen" : "Passwort anzeigen");
});

els.resetPasswordButton.addEventListener("click", async () => {
  await initializeSupabaseClient();
  if (!supabaseClient) {
    setAuthMessage(authUnavailableMessage(), "error");
    return updateAuthView();
  }
  const email = els.authEmailInput.value.trim();
  if (!email) {
    setAuthMessage("Gib zuerst deine E-Mail-Adresse ein, dann schicken wir dir den Link zum Zurücksetzen.", "error");
    els.authEmailInput.focus();
    return;
  }
  setAuthMessage("Link zum Zurücksetzen wird gesendet...");
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectUrl()
  });
  if (error) {
    const message = friendlyAuthError(error);
    setAuthMessage(message, "error");
    setCloudStatus(message, "error");
    return;
  }
  setAuthMessage("E-Mail zum Zurücksetzen wurde gesendet. Bitte prüfe dein Postfach.", "success");
  setCloudStatus("Passwort-E-Mail wurde gesendet. Du bist nicht eingeloggt, bis das neue Passwort gespeichert ist.", "local");
});

els.logoutButton.addEventListener("click", async () => {
  els.logoutButton.disabled = true;
  els.logoutButton.textContent = "Melde ab...";
  try {
    await logout();
  } finally {
    els.logoutButton.disabled = false;
    els.logoutButton.textContent = "Abmelden";
  }
});
els.accountProfileButton.addEventListener("click", openAccountSettings);
els.accountSyncButton.addEventListener("click", saveFromAccountMenu);

els.saveProfileButton.addEventListener("click", () => {
  saveCurrentProfile().catch((error) => {
    console.error(error);
    setCloudStatus(error.message || "Profil konnte nicht gespeichert werden.", "error");
  });
});
els.profileNameInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  els.saveProfileButton.click();
});
els.changeEmailButton.addEventListener("click", () => {
  changeAccountEmail().catch((error) => {
    console.error(error);
    setCloudStatus(error.message || "E-Mail konnte nicht geändert werden.", "error");
  });
});
els.changePasswordButton.addEventListener("click", () => {
  changeAccountPassword().catch((error) => {
    console.error(error);
    setCloudStatus(error.message || "Passwort konnte nicht gespeichert werden.", "error");
  });
});
els.profilePasswordConfirmInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  els.changePasswordButton.click();
});
els.profileResetPasswordButton.addEventListener("click", () => {
  sendProfilePasswordReset().catch((error) => {
    console.error(error);
    setCloudStatus(error.message || "Passwort-Link konnte nicht gesendet werden.", "error");
  });
});

if (els.addAccountFriendButton) {
  els.addAccountFriendButton.addEventListener("click", async () => {
    if (els.addAccountFriendButton.disabled) return;
    els.addAccountFriendButton.disabled = true;
    els.addAccountFriendButton.setAttribute("aria-busy", "true");
    try {
      const friendResult = await addFriendToAccount(els.accountFriendNameInput.value);
      if (!friendResult) return;
      els.accountFriendNameInput.value = "";
      renderAccountFriends();
      els.accountFriendNameInput.focus();
    } finally {
      els.addAccountFriendButton.disabled = false;
      els.addAccountFriendButton.removeAttribute("aria-busy");
    }
  });
}

if (els.accountFriendNameInput) {
  els.accountFriendNameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    els.addAccountFriendButton?.click();
  });
}

if (els.accountFriendsList) {
  els.accountFriendsList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-remove-friend]");
    if (!button) return;
    await removeFriendFromAccount(button.dataset.removeFriend, button.dataset.friendId || "");
  });
}

if (els.accountFriendRequests) {
  els.accountFriendRequests.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-friend-response]");
    if (!button) return;
    button.disabled = true;
    await respondToFriendRequest(button.dataset.requestId || "", button.dataset.friendResponse === "accept");
  });
}

function handleTripFriendPickerClick(container, options = {}) {
  return (event) => {
    const button = event.target.closest("[data-trip-friend]");
    if (!button || !container?.contains(button)) return;
    button.classList.toggle("active");
    button.setAttribute("aria-pressed", String(button.classList.contains("active")));
    if (options.autosave) scheduleManageTripAutosave();
    if (options.saveTripFriends) saveTripFriendsDialog({ close: false });
  };
}

async function addFriendFromTripDialog(scope) {
  const isManage = scope === "manage";
  const input = isManage ? els.manageDialogTripFriendInput : els.newTripFriendInput;
  const container = isManage ? els.manageDialogTripFriendsList : els.newTripFriendsList;
  const friend = normalizeFriendName(input?.value);
  const friendResult = friend ? await addFriendToAccount(friend) : false;
  if (!friendResult) return;
  if (input) input.value = "";
  if (!friendResult.accepted) {
    input?.focus();
    return;
  }
  const addedName = friendResult.name;
  const selected = normalizeFriendList([...selectedFriendsFromPicker(container), addedName]);
  renderTripFriendPicker(container, selected);
  if (isManage) {
    saveManageTripDialog();
    return;
  }
  input?.focus();
}

async function addFriendFromTripFriendsDialog() {
  const friend = normalizeFriendName(els.tripFriendsInput?.value);
  const friendResult = friend ? await addFriendToAccount(friend) : false;
  if (!friendResult) return;
  if (els.tripFriendsInput) els.tripFriendsInput.value = "";
  if (!friendResult.accepted) {
    els.tripFriendsInput?.focus();
    return;
  }
  const addedName = friendResult.name;
  const selected = normalizeFriendList([...selectedFriendsFromPicker(els.tripFriendsList), addedName]);
  renderTripFriendPicker(els.tripFriendsList, selected);
  if (els.tripFriendsInput) {
    els.tripFriendsInput.focus();
  }
  saveTripFriendsDialog({ close: false });
}

els.newTripFriendsList?.addEventListener("click", handleTripFriendPickerClick(els.newTripFriendsList));
els.manageDialogTripFriendsList?.addEventListener("click", handleTripFriendPickerClick(els.manageDialogTripFriendsList, { autosave: true }));
els.tripFriendsList?.addEventListener("click", handleTripFriendPickerClick(els.tripFriendsList, { autosave: true, saveTripFriends: true }));
els.addNewTripFriendButton?.addEventListener("click", () => addFriendFromTripDialog("new"));
els.addManageTripFriendButton?.addEventListener("click", () => addFriendFromTripDialog("manage"));
els.addTripFriendsButton?.addEventListener("click", addFriendFromTripFriendsDialog);
els.closeTripFriendsButton?.addEventListener("click", closeTripFriendsDialog);
els.addFriendFromTripButton?.addEventListener("click", () => {
  closeTripFriendsDialog();
  openAccountFriendsSettings();
});
els.tripFriendsBackdrop?.addEventListener("click", closeTripFriendsDialog);
els.newTripFriendInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addFriendFromTripDialog("new");
});
els.manageDialogTripFriendInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addFriendFromTripDialog("manage");
});
els.tripFriendsInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addFriendFromTripFriendsDialog();
});

els.syncToCloudButton.addEventListener("click", () => {
  uploadStateToCloud().catch((error) => console.error(error));
});


els.loadFromCloudButton.addEventListener("click", () => {
  loadStateFromCloud().catch((error) => console.error(error));
});

els.enableLiveSyncButton.addEventListener("click", () => {
  if (!ensureCloudReady()) return;
  cloudSyncEnabled = true;
  subscribeToCloudChanges();
  setCloudStatus("Automatisches Speichern ist aktiv.", "online");
});


els.leaveTripButton.addEventListener("click", () => {
  leaveActiveTrip().catch((error) => console.error(error));
});

channel?.addEventListener("message", (event) => {
  if (!canEditLists()) return;
  state = event.data;
  saveState(false);
  render();
});

render();
initCloud();
updateConnectionBanner();
const initialParams = new URLSearchParams(window.location.search);
if (initialParams.get("view")) activateView(initialParams.get("view"));
if (initialParams.get("action") === "new-trip") els.createTripButton.click();
