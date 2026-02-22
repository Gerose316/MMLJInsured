// ═══════════════════════════════════════════════════════════════
// app.js — MMLJInsured (merged CareAssist + Goals, no AI)
// ═══════════════════════════════════════════════════════════════

import { initializeApp }          from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         signOut, onAuthStateChanged, updateProfile }
                                  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy,
         getDocs, doc, setDoc, deleteDoc, updateDoc, onSnapshot }
                                  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Firebase config ───────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyBRssQl6Nf00ShYVgb3wpdrK04diPLrcns",
  authDomain:        "careassist-c33c6.firebaseapp.com",
  projectId:         "careassist-c33c6",
  storageBucket:     "careassist-c33c6.firebasestorage.app",
  messagingSenderId: "954422427256",
  appId:             "1:954422427256:web:c0b9d20230ec9bc586f78d",
  measurementId:     "G-GFGHZW7BG9",
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);

// ── App state ─────────────────────────────────────────────────
let currentUser  = null;
let selectedTags = [];
let medications  = [];
let goals        = [];
let focusTime    = 25 * 60;
let timerInterval = null;
let isRunning    = false;
let currentMonth = new Date();
let selectedCategory = "All";
let activeMedId  = null;

// ── Quotes ───────────────────────────────────────────────────
const quotes = [
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Success is not final, failure is not fatal.", author: "Winston Churchill" },
  { text: "Don't watch the clock; do what it does.", author: "Sam Levenson" },
  { text: "The future depends on what you do today.", author: "Mahatma Gandhi" },
  { text: "You are never too old to set another goal.", author: "C.S. Lewis" },
  { text: "Take care of your body. It's the only place you have to live.", author: "Jim Rohn" },
  { text: "Health is a state of complete harmony of the body, mind and spirit.", author: "B.K.S. Iyengar" },
];

const categories = ["All", "Work", "Health", "Learning", "Hobbies", "Personal"];

// ════════════════════════════════════════════════════════════════
// INITIALISATION
// ════════════════════════════════════════════════════════════════

function init() {
  const now    = new Date();
  const timeEl = document.getElementById("m-time");
  if (timeEl) {
    timeEl.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
  updateClock();
  setInterval(updateClock, 1000);
  updateQuote();
  setInterval(updateQuote, 300000);
  renderCategories();
  renderCalendar();
  updateTimerDisplay();
  initTheme();

  // Watch severity selector to show emergency banner
  document.getElementById("sym-level")?.addEventListener("change", function () {
    const bar = document.getElementById("em-input-bar");
    if (bar) bar.style.display = this.value === "emergency" ? "flex" : "none";
  });
}


// ════════════════════════════════════════════════════════════════
// THEME SWITCHER
// ════════════════════════════════════════════════════════════════

function initTheme() {
  const saved = localStorage.getItem("mmljinsured_theme") || "dark";
  applyTheme(saved);
}

window.setTheme = (theme) => {
  localStorage.setItem("mmljinsured_theme", theme);
  applyTheme(theme);
};

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  // Update active button state
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

function updateClock() {
  const now = new Date();
  const cl  = document.getElementById("header-clock");
  if (cl) cl.textContent = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function updateQuote() {
  const q   = quotes[Math.floor(Math.random() * quotes.length)];
  const qt  = document.getElementById("quote-text");
  const qa  = document.getElementById("quote-author");
  if (qt) qt.textContent  = `"${q.text}"`;
  if (qa) qa.textContent  = `— ${q.author}`;
}


// ════════════════════════════════════════════════════════════════
// FIREBASE AUTH
// ════════════════════════════════════════════════════════════════

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    const name  = user.displayName || user.email.split("@")[0];
    document.getElementById("user-nm").textContent = name;
    document.getElementById("user-av").textContent = name.substring(0, 2).toUpperCase();

    document.getElementById("auth-screen").style.display = "none";
    document.getElementById("app-screen").style.display  = "block";

    init();
    loadMedications();
    loadHistory();
    loadGoals();
  } else {
    currentUser = null;
    document.getElementById("auth-screen").style.display = "flex";
    document.getElementById("app-screen").style.display  = "none";
  }
});

window.switchTab = (tab) => {
  const tabs = document.querySelectorAll(".auth-tab");
  tabs[0].classList.toggle("active", tab === "login");
  tabs[1].classList.toggle("active", tab === "signup");
  document.getElementById("login-form").style.display  = tab === "login"  ? "block" : "none";
  document.getElementById("signup-form").style.display = tab === "signup" ? "block" : "none";
  const errEl = document.getElementById("auth-err");
  errEl.textContent   = "";
  errEl.style.display = "none";
};

window.doLogin = async () => {
  const email = document.getElementById("li-email").value.trim();
  const pw    = document.getElementById("li-pw").value;
  if (!email || !pw) { showAuthErr("Please enter your email and password."); return; }

  const btn = document.querySelector("#login-form .btn-primary");
  btn.disabled = true; btn.textContent = "Signing in…";

  try {
    await signInWithEmailAndPassword(auth, email, pw);
  } catch (e) {
    showAuthErr(friendlyAuthError(e.code));
    btn.disabled = false; btn.textContent = "Sign In";
  }
};

window.doSignup = async () => {
  const name  = document.getElementById("su-name").value.trim();
  const email = document.getElementById("su-email").value.trim();
  const pw    = document.getElementById("su-pw").value;

  if (!name)         { showAuthErr("Please enter your full name.");            return; }
  if (!email)        { showAuthErr("Please enter your email address.");        return; }
  if (!pw)           { showAuthErr("Please choose a password.");               return; }
  if (pw.length < 6) { showAuthErr("Password must be at least 6 characters."); return; }

  const btn = document.querySelector("#signup-form .btn-primary");
  btn.disabled = true; btn.textContent = "Creating account…";

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await updateProfile(cred.user, { displayName: name });
  } catch (e) {
    showAuthErr(friendlyAuthError(e.code));
    btn.disabled = false; btn.textContent = "Create Account";
  }
};

window.doLogout = () => signOut(auth);

function showAuthErr(msg) {
  const el = document.getElementById("auth-err");
  el.textContent   = msg;
  el.style.display = "block";
}

function friendlyAuthError(code) {
  const map = {
    "auth/user-not-found":         "No account found with that email address.",
    "auth/wrong-password":         "Incorrect password. Please try again.",
    "auth/invalid-credential":     "Incorrect email or password. Please try again.",
    "auth/email-already-in-use":   "An account with that email already exists.",
    "auth/invalid-email":          "Please enter a valid email address.",
    "auth/weak-password":          "Password must be at least 6 characters.",
    "auth/too-many-requests":      "Too many attempts. Please wait and try again.",
    "auth/network-request-failed": "Network error. Check your connection.",
  };
  return map[code] || "Something went wrong. Please try again.";
}


// ════════════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════════════

window.showPanel = (name) => {
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById("panel-" + name).classList.add("active");
  const navBtn = document.getElementById("nav-" + name);
  if (navBtn) navBtn.classList.add("active");
  if (name === "account") { refreshAccountPanel(); updateApikeyStatus(); }
  if (name === "chat")    initChat();
};


// ════════════════════════════════════════════════════════════════
// SYMPTOM QUICK-TAGS
// ════════════════════════════════════════════════════════════════

window.toggleTag = (el, tag) => {
  el.classList.toggle("sel");
  selectedTags = el.classList.contains("sel")
    ? [...selectedTags, tag]
    : selectedTags.filter((t) => t !== tag);
};


// ════════════════════════════════════════════════════════════════
// SYMPTOM LOG  (manual — no AI)
// ════════════════════════════════════════════════════════════════

window.logSymptoms = async () => {
  const desc     = document.getElementById("symptom-text").value.trim();
  const duration = document.getElementById("sym-duration").value;
  const severity = document.getElementById("sym-severity").value;
  const level    = document.getElementById("sym-level").value;

  if (!desc && selectedTags.length === 0) {
    showToast("Please describe your symptoms", "error");
    return;
  }

  const tagStr   = selectedTags.join(", ");
  const fullDesc = [desc, tagStr ? `Symptoms: ${tagStr}` : ""].filter(Boolean).join("\n");

  const btn = document.getElementById("log-btn");
  btn.disabled = true; btn.textContent = "Saving…";

  const levelLabels = {
    low:       "Mild Symptoms",
    medium:    "Moderate — Monitor Closely",
    high:      "Serious — See Doctor Soon",
    emergency: "Emergency — Seek Care Now",
  };

  try {
    await addDoc(collection(db, "symptom_history"), {
      userId:         currentUser.uid,
      symptoms:       fullDesc.substring(0, 500),
      duration,
      severity_input: severity,
      result: {
        severity_level: level,
        severity_label: levelLabels[level],
      },
      timestamp: new Date(),
    });

    // Reset form
    document.getElementById("symptom-text").value = "";
    document.getElementById("sym-severity").value = "5";
    document.getElementById("sym-level").value    = "low";
    document.getElementById("em-input-bar").style.display = "none";
    selectedTags = [];
    document.querySelectorAll(".stag.sel").forEach((t) => t.classList.remove("sel"));

    showToast("Symptom log saved ✓", "success");
    loadHistory();
  } catch (e) {
    showToast("Error saving: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "✦ Save Symptom Log";
  }
};

window.callEmergency = () => {
  if (confirm("This will call 911 (emergency services). Continue?"))
    window.location.href = "tel:911";
};

// ── Analyze with AI: saves log + AI response to Firestore ───────
window.analyzeWithAI = async () => {
  const desc     = document.getElementById("symptom-text").value.trim();
  const duration = document.getElementById("sym-duration").value;
  const severity = document.getElementById("sym-severity").value;
  const level    = document.getElementById("sym-level").value;

  if (!desc && selectedTags.length === 0) {
    showToast("Please describe your symptoms first", "error");
    return;
  }
  const key = getGeminiKey();
  if (!key) {
    showToast("Add your Gemini API key in My Account first", "error");
    showPanel("account");
    return;
  }

  const tagStr   = selectedTags.join(", ");
  const fullDesc = [desc, tagStr ? `Symptoms: ${tagStr}` : ""].filter(Boolean).join("\n");

  const msgParts = [];
  if (desc)   msgParts.push(desc);
  if (tagStr) msgParts.push(`Selected symptoms: ${tagStr}`);
  msgParts.push(`Duration: ${duration}`);
  msgParts.push(`Self-rated severity: ${severity}/10`);
  const userMsg = msgParts.join("\n");

  const levelLabels = {
    low: "Mild Symptoms", medium: "Moderate — Monitor Closely",
    high: "Serious — See Doctor Soon", emergency: "Emergency — Seek Care Now",
  };

  const btn = document.getElementById("ai-analyze-btn");
  if (btn) { btn.disabled = true; btn.textContent = "🤖 Analyzing…"; }

  try {
    // Call AI first
    const aiReply = await callGemini([{ role: "user", parts: [{ text: userMsg }] }]);

    // Save log + AI analysis to Firestore together
    await addDoc(collection(db, "symptom_history"), {
      userId:         currentUser.uid,
      symptoms:       fullDesc.substring(0, 500),
      duration,
      severity_input: severity,
      result: {
        severity_level: level,
        severity_label: levelLabels[level],
      },
      aiAnalysis: aiReply,
      timestamp:  new Date(),
    });

    // Reset form
    document.getElementById("symptom-text").value = "";
    document.getElementById("sym-severity").value = "5";
    document.getElementById("sym-level").value    = "low";
    document.getElementById("em-input-bar").style.display = "none";
    selectedTags = [];
    document.querySelectorAll(".stag.sel").forEach((t) => t.classList.remove("sel"));

    showToast("Log + AI analysis saved ✓", "success");
    loadHistory();

    // Switch to AI Chat tab and show the exchange
    showPanel("chat");
    setTimeout(() => {
      appendUserMessage(userMsg);
      chatHistory.push({ role: "user",  parts: [{ text: userMsg  }] });
      chatHistory.push({ role: "model", parts: [{ text: aiReply }] });
      appendBotMessage(aiReply);
    }, 150);

  } catch (e) {
    showToast("Error: " + e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🤖 Save + AI Analysis"; }
  }
};


// ════════════════════════════════════════════════════════════════
// GOALS
// ════════════════════════════════════════════════════════════════

function loadGoals() {
  if (!currentUser) return;
  const q = query(collection(db, "goals"), where("userId", "==", currentUser.uid));
  onSnapshot(q, (snapshot) => {
    goals = [];
    snapshot.forEach((d) => goals.push({ id: d.id, ...d.data() }));
    renderGoals();
  });
}

function renderCategories() {
  const list = document.getElementById("categoryList");
  if (!list) return;
  list.innerHTML = categories.map((cat) => `
    <button class="category-btn ${cat === selectedCategory ? "active" : ""}" onclick="filterCategory('${cat}')">
      ${getCatEmoji(cat)} ${cat === "All" ? "All Goals" : cat}
    </button>
  `).join("");
}

function getCatEmoji(cat) {
  const map = { All: "✨", Work: "💼", Health: "💪", Learning: "🎓", Hobbies: "🎮", Personal: "⭐" };
  return map[cat] || "•";
}

window.filterCategory = (cat) => {
  selectedCategory = cat;
  renderCategories();
  renderGoals();
};

function renderGoals() {
  const filtered = selectedCategory === "All" ? goals : goals.filter((g) => g.category === selectedCategory);
  const grid     = document.getElementById("goalsGrid");
  if (!grid) return;

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state"><div class="ei">🎯</div><p>No goals yet.<br>Add one to get started!</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map((goal) => `
    <div class="goal-card ${goal.completed ? "completed" : ""}">
      <div class="goal-card-top">
        <div class="goal-title">${goal.title}</div>
        <input type="checkbox" ${goal.completed ? "checked" : ""} onchange="toggleGoal('${goal.id}')">
      </div>
      <span class="goal-category">${getCatEmoji(goal.category)} ${goal.category}</span>
      ${goal.notes ? `<p class="goal-notes">${goal.notes}</p>` : ""}
      <div class="progress-bar">
        <div class="progress-fill" style="width:${goal.progress || 0}%"></div>
      </div>
      <div class="progress-label">${goal.progress || 0}% complete</div>
      <div class="goal-actions">
        <button class="btn-progress" onclick="updateProgress('${goal.id}', 10)">+10%</button>
        <button class="btn-progress" onclick="updateProgress('${goal.id}', -10)">−10%</button>
        <button class="btn-del" onclick="deleteGoal('${goal.id}')">🗑</button>
      </div>
    </div>
  `).join("");
}

window.openAddGoalModal  = () => document.getElementById("goal-modal").classList.add("open");
window.closeAddGoalModal = () => {
  document.getElementById("goal-modal").classList.remove("open");
  document.getElementById("goalTitle").value = "";
  document.getElementById("goalNotes").value = "";
};

window.addGoal = async () => {
  const title    = document.getElementById("goalTitle").value.trim();
  const category = document.getElementById("goalCategory").value;
  const notes    = document.getElementById("goalNotes").value.trim();
  if (!title) { showToast("Please enter a goal title", "error"); return; }

  try {
    await addDoc(collection(db, "goals"), {
      userId: currentUser.uid,
      title, category, notes,
      progress: 0, completed: false, createdAt: new Date(),
    });
    closeAddGoalModal();
    showToast("Goal added ✓", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

window.toggleGoal = async (id) => {
  const goal = goals.find((g) => g.id === id);
  if (!goal) return;
  try {
    await updateDoc(doc(db, "goals", id), {
      completed: !goal.completed,
      progress:  !goal.completed ? 100 : goal.progress,
    });
  } catch (e) { console.error(e); }
};

window.updateProgress = async (id, amount) => {
  const goal = goals.find((g) => g.id === id);
  if (!goal) return;
  const newProg = Math.max(0, Math.min(100, (goal.progress || 0) + amount));
  try {
    await updateDoc(doc(db, "goals", id), { progress: newProg });
  } catch (e) { console.error(e); }
};

window.deleteGoal = async (id) => {
  if (!confirm("Delete this goal?")) return;
  try {
    await deleteDoc(doc(db, "goals", id));
    showToast("Goal removed");
  } catch (e) { showToast("Error: " + e.message, "error"); }
};


// ════════════════════════════════════════════════════════════════
// MEDICATION TRACKING
// ════════════════════════════════════════════════════════════════

async function loadMedications() {
  if (!currentUser) return;
  const q    = query(collection(db, "medications"), where("userId", "==", currentUser.uid));
  const snap = await getDocs(q);
  medications = [];
  snap.forEach((d) => medications.push({ id: d.id, ...d.data() }));
  renderMedications();
}

function renderMedications() {
  const list = document.getElementById("meds-list");
  if (!medications.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="ei">💊</div>
        <p>No medications added yet.<br>Add a medication to start tracking your doses.</p>
      </div>`;
    return;
  }
  list.innerHTML = "";
  medications.forEach((med) => {
    const el  = document.createElement("div");
    el.className = "med-row";
    const now = new Date();
    let tag   = "";
    if (med.nextDose) {
      const dt   = new Date(`${now.toDateString()} ${med.nextDose}`);
      const diff = (dt - now) / 60000;
      if      (diff < -30) tag = `<span class="dose-tag dose-late">OVERDUE</span>`;
      else if (diff <  30) tag = `<span class="dose-tag dose-due">DUE NOW</span>`;
      else                 tag = `<span class="dose-tag dose-ok">NEXT ${med.nextDose}</span>`;
    }
    el.innerHTML = `
      <div class="med-icon-wrap">💊</div>
      <div class="med-row-info">
        <div class="mn">${med.name}</div>
        <div class="md">${med.dosage} · ${med.frequency}</div>
        ${med.notes ? `<div class="mnotes">${med.notes}</div>` : ""}
        ${tag ? `<div style="margin-top:6px">${tag}</div>` : ""}
      </div>
      <div class="med-row-actions">
        <button class="btn-take" onclick="event.stopPropagation(); markTaken('${med.id}')">✓ Taken</button>
        <button class="btn-del"  onclick="event.stopPropagation(); deleteMed('${med.id}')">🗑</button>
      </div>
    `;
    el.addEventListener("click", () => openMedDetail(med.id));
    list.appendChild(el);
  });
}

window.openMedModal  = () => document.getElementById("med-modal").classList.add("open");
window.closeMedModal = () => {
  document.getElementById("med-modal").classList.remove("open");
  ["m-name", "m-dose", "m-notes"].forEach((id) => (document.getElementById(id).value = ""));
};

window.saveMed = async () => {
  const name = document.getElementById("m-name").value.trim();
  const dose = document.getElementById("m-dose").value.trim();
  if (!name || !dose) { showToast("Name and dosage are required", "error"); return; }
  await addDoc(collection(db, "medications"), {
    userId: currentUser.uid,
    name, dosage: dose,
    frequency: document.getElementById("m-freq").value,
    nextDose:  document.getElementById("m-time").value,
    notes:     document.getElementById("m-notes").value.trim(),
    createdAt: new Date(),
  });
  closeMedModal();
  showToast("Medication saved ✓", "success");
  loadMedications();
};

window.markTaken = async (id) => {
  const med = medications.find((m) => m.id === id);
  if (!med) return;
  const freqHours = {
    "Once daily": 24, "Twice daily": 12, "Three times daily": 8,
    "Every 4 hours": 4, "Every 6 hours": 6, "Every 8 hours": 8, "As needed (PRN)": 0,
  };
  const hours = freqHours[med.frequency] || 0;
  let nextDose = "";
  if (hours) {
    const next = new Date();
    next.setHours(next.getHours() + hours);
    nextDose = `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`;
  }
  await setDoc(doc(db, "medications", id), { ...med, nextDose, lastTaken: new Date() }, { merge: true });
  showToast("Dose recorded ✓", "success");
  loadMedications();
};

window.deleteMed = async (id) => {
  if (!confirm("Remove this medication?")) return;
  await deleteDoc(doc(db, "medications", id));
  showToast("Medication removed");
  loadMedications();
};

window.openMedDetail = (id) => {
  const med = medications.find((m) => m.id === id);
  if (!med) return;
  activeMedId = id;
  document.getElementById("mdm-name").textContent      = med.name;
  document.getElementById("mdm-sub").textContent       = `${med.dosage} · ${med.frequency}`;
  document.getElementById("mdm-dosage").textContent    = med.dosage;
  document.getElementById("mdm-frequency").textContent = med.frequency;
  document.getElementById("mdm-nextdose").textContent  = med.nextDose || "—";
  const hasNotes = !!(med.notes && med.notes.trim());
  document.getElementById("mdm-notes-row").style.display     = hasNotes ? "flex" : "none";
  document.getElementById("mdm-notes-divider").style.display = hasNotes ? "block" : "none";
  if (hasNotes) document.getElementById("mdm-notes").textContent = med.notes;
  document.getElementById("med-detail-modal").classList.add("open");
};

window.closeMedDetailModal = () => {
  document.getElementById("med-detail-modal").classList.remove("open");
  activeMedId = null;
};

window.reportMedToAI = () => {
  const med = medications.find((m) => m.id === activeMedId);
  if (!med) return;

  const key = getGeminiKey();
  if (!key) {
    showToast("Add your Gemini API key in My Account first", "error");
    closeMedDetailModal();
    showPanel("account");
    return;
  }

  // Build the prompt for this specific medication
  // Include all other meds for interaction checking
  const otherMeds = medications
    .filter((m) => m.id !== med.id)
    .map((m) => `• ${m.name} — ${m.dosage}, ${m.frequency}`)
    .join("\n");

  const prompt = [
    `I need you to check this medication for any issues:`,
    ``,
    `**Medication:** ${med.name}`,
    `**Dosage:** ${med.dosage}`,
    `**Frequency:** ${med.frequency}`,
    `**Next dose:** ${med.nextDose || "not set"}`,
    med.notes ? `**Notes:** ${med.notes}` : null,
    ``,
    otherMeds
      ? `I am also currently taking:\n${otherMeds}\n\nPlease check for interactions with these as well.`
      : `This is the only medication I am taking.`,
    ``,
    `Please check: (1) Is this dosage and frequency clinically appropriate? (2) Any known side effects or warnings I should know about? (3) Any interactions with my other medications? (4) Correct procedure for taking it (food, water, timing, etc.)? (5) Any red flags I should report to my doctor?`,
  ].filter((l) => l !== null).join("\n");

  // Close modal, go to chat, send the message
  closeMedDetailModal();
  showPanel("chat");

  setTimeout(() => {
    const input = document.getElementById("chat-input");
    if (input) {
      input.value = prompt;
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
      sendChatMessage();
    }
  }, 200);
};

window.deleteMedFromDetail = async () => {
  if (!activeMedId) return;
  if (!confirm("Remove this medication?")) return;
  await deleteDoc(doc(db, "medications", activeMedId));
  closeMedDetailModal();
  showToast("Medication removed");
  loadMedications();
};


// ════════════════════════════════════════════════════════════════
// SYMPTOM HISTORY
// ════════════════════════════════════════════════════════════════

// In-memory store of history rows for PDF generation
let historyRows = [];

async function loadHistory() {
  if (!currentUser) return;
  try {
    const q    = query(
      collection(db, "symptom_history"),
      where("userId", "==", currentUser.uid),
      orderBy("timestamp", "desc")
    );
    const snap = await getDocs(q);
    const list = document.getElementById("history-list");
    const dlBtn = document.getElementById("btn-download-all");

    historyRows = [];

    if (snap.empty) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="ei">📋</div>
          <p>No logs yet.<br>Your symptom history will appear here.</p>
        </div>`;
      if (dlBtn) dlBtn.style.display = "none";
      return;
    }

    // Collect all rows into memory for PDF export
    snap.forEach((d) => historyRows.push({ id: d.id, ...d.data() }));
    if (dlBtn) dlBtn.style.display = "flex";

    list.innerHTML = "";
    historyRows.forEach((data, idx) => {
      const ts  = data.timestamp?.toDate?.() || new Date();
      const lvl = data.result?.severity_level || "low";
      const el  = document.createElement("div");
      el.className = "hist-item";
      el.innerHTML = `
        <div class="hist-top">
          <span class="hist-date">
            ${ts.toLocaleDateString()} · ${ts.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}
          </span>
          <span class="sev-pill ${lvl === "emergency" ? "high" : lvl}">
            ${data.result?.severity_label || lvl}
          </span>
        </div>
        <div class="hist-text">${data.symptoms || "No description"}</div>
        <div class="hist-meta">Duration: ${data.duration || "—"} · Severity: ${data.severity_input || "—"}/10</div>
        ${data.aiAnalysis ? `
          <div class="hist-ai-block">
            <div class="hist-ai-label">🤖 AI Analysis</div>
            <div class="hist-ai-body">${formatChatText(data.aiAnalysis)}</div>
          </div>` : ""}
        <div class="hist-footer">
          <button class="hist-pdf-btn" onclick="downloadSinglePDF(${idx})">📄 Download PDF</button>
        </div>
      `;
      list.appendChild(el);
    });
  } catch (e) {
    console.error("History load error:", e);
  }
}


// ════════════════════════════════════════════════════════════════
// PDF GENERATION
// ════════════════════════════════════════════════════════════════

function buildPDF(rows, title) {
  const { jsPDF } = window.jspdf;
  const pdf    = new jsPDF({ unit: "mm", format: "a4" });
  const pageW  = pdf.internal.pageSize.getWidth();
  const pageH  = pdf.internal.pageSize.getHeight();
  const margin = 16;
  const colW   = pageW - margin * 2;

  const userName  = currentUser?.displayName || currentUser?.email?.split("@")[0] || "User";
  const generated = new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" });

  const lvlColors = {
    low:       [34,  197, 94],
    medium:    [234, 179,  8],
    high:      [249, 115, 22],
    emergency: [239,  68, 68],
  };

  // ── Helper: add a new page if needed ──
  let y = 0;
  function checkPage(needed = 10) {
    if (y + needed > pageH - 18) {
      pdf.addPage();
      y = 14;
    }
  }

  // ── Cover / header band ──
  function drawHeader(isFirst) {
    pdf.setFillColor(15, 23, 42);           // slate-900
    pdf.rect(0, 0, pageW, 26, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text("MMLJInsured", margin, 11);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text("Health & Symptom Report", margin, 18);
    pdf.text(`${userName}  ·  Generated ${generated}`, pageW - margin, 18, { align: "right" });
    if (isFirst && title) {
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "italic");
      pdf.text(title, margin, 23);
    }
  }

  // ── Section label ──
  function sectionLabel(text) {
    checkPage(14);
    pdf.setFillColor(241, 245, 249);        // slate-100
    pdf.rect(margin, y, colW, 7, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(71, 85, 105);          // slate-500
    pdf.text(text.toUpperCase(), margin + 3, y + 5);
    y += 11;
  }

  // ── Key/value row ──
  function kvRow(label, value) {
    const val   = String(value || "—");
    const lines = pdf.splitTextToSize(val, colW - 38);
    const h     = lines.length * 5 + 4;
    checkPage(h + 2);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text(label, margin + 2, y + 4);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(15, 23, 42);
    pdf.text(lines, margin + 38, y + 4);
    y += h;
  }

  // ── Body text (wrapped) ──
  function bodyText(text) {
    const clean = text.replace(/\*\*(.+?)\*\*/g, "$1"); // strip markdown bold
    const lines = pdf.splitTextToSize(clean, colW);
    lines.forEach((line) => {
      checkPage(6);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.5);
      pdf.setTextColor(30, 41, 59);
      pdf.text(line, margin, y);
      y += 5;
    });
    y += 3;
  }

  // ── Disclaimer box ──
  function disclaimer() {
    checkPage(20);
    pdf.setFillColor(254, 243, 199);
    pdf.roundedRect(margin, y, colW, 14, 2, 2, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(146, 64, 14);
    pdf.text("Medical Disclaimer", margin + 3, y + 5);
    pdf.setFont("helvetica", "normal");
    pdf.text(
      "This report is for personal tracking only and is NOT medical advice. Always consult a qualified healthcare provider.",
      margin + 3, y + 10, { maxWidth: colW - 6 }
    );
    y += 18;
  }

  // ── Footer on every page ──
  function addFooters() {
    const total = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      pdf.setPage(i);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.setTextColor(148, 163, 184);
      pdf.text(
        `MMLJInsured Health Report  ·  Page ${i} of ${total}`,
        pageW / 2, pageH - 6, { align: "center" }
      );
    }
  }

  // ══ Build pages ══
  drawHeader(true);
  y = 32;

  rows.forEach((data, idx) => {
    const ts  = (data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp)) || new Date();
    const lvl = data.result?.severity_level || "low";
    const [r, g, b] = lvlColors[lvl] || lvlColors.low;

    if (idx > 0) {
      checkPage(30);
      // thin divider between entries
      pdf.setDrawColor(226, 232, 240);
      pdf.line(margin, y - 4, pageW - margin, y - 4);
    }

    // Entry heading with coloured severity pill
    checkPage(16);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(15, 23, 42);
    const dateStr = ts.toLocaleDateString("en-US", { weekday:"short", year:"numeric", month:"short", day:"numeric" })
                  + "  ·  "
                  + ts.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
    pdf.text(dateStr, margin, y + 5);

    // Pill
    const label = (data.result?.severity_label || lvl).toUpperCase();
    const pillW = pdf.getTextWidth(label) + 6;
    pdf.setFillColor(r, g, b);
    pdf.roundedRect(pageW - margin - pillW, y, pillW, 7, 1.5, 1.5, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.setTextColor(255, 255, 255);
    pdf.text(label, pageW - margin - pillW + 3, y + 5);
    y += 12;

    sectionLabel("Symptom Details");
    kvRow("Symptoms",    data.symptoms || "—");
    kvRow("Duration",    data.duration || "—");
    kvRow("Severity",    `${data.severity_input || "—"} / 10`);

    if (data.aiAnalysis) {
      sectionLabel("AI Analysis");
      bodyText(data.aiAnalysis);
    }

    y += 4;
  });

  disclaimer();
  addFooters();
  return pdf;
}

// Download PDF for a single log entry
window.downloadSinglePDF = (idx) => {
  const row = historyRows[idx];
  if (!row) return;
  const ts  = (row.timestamp?.toDate ? row.timestamp.toDate() : new Date()) || new Date();
  const pdf = buildPDF([row], "Single Symptom Log");
  pdf.save(`health-log-${ts.toISOString().slice(0, 10)}.pdf`);
  showToast("PDF downloaded ✓", "success");
};

// Download PDF for all logs
window.downloadAllPDF = () => {
  if (!historyRows.length) { showToast("No logs to export", "error"); return; }
  const pdf = buildPDF(historyRows, `All Symptom Logs — ${historyRows.length} entries`);
  const today = new Date().toISOString().slice(0, 10);
  pdf.save(`health-report-all-${today}.pdf`);
  showToast(`PDF with ${historyRows.length} logs downloaded ✓`, "success");
};


// ════════════════════════════════════════════════════════════════
// FOCUS TIMER
// ════════════════════════════════════════════════════════════════

window.startFocus = () => {
  if (isRunning) return;
  focusTime = parseInt(document.getElementById("focusMinutes").value) * 60;
  if (isNaN(focusTime) || focusTime <= 0) { showToast("Enter a valid number of minutes", "error"); return; }
  isRunning = true;
  document.getElementById("startBtn").style.display = "none";
  document.getElementById("pauseBtn").style.display = "flex";
  document.getElementById("timer-label").textContent = "Focusing…";

  timerInterval = setInterval(() => {
    if (focusTime > 0) {
      focusTime--;
      updateTimerDisplay();
    } else {
      clearInterval(timerInterval);
      isRunning = false;
      document.getElementById("startBtn").style.display = "flex";
      document.getElementById("pauseBtn").style.display = "none";
      document.getElementById("timer-label").textContent = "Session complete! 🎉";
      showToast("🎉 Focus session complete!", "success");
    }
  }, 1000);
};

window.pauseFocus = () => {
  clearInterval(timerInterval);
  isRunning = false;
  document.getElementById("startBtn").style.display = "flex";
  document.getElementById("pauseBtn").style.display = "none";
  document.getElementById("timer-label").textContent = "Paused";
};

window.resetFocus = () => {
  clearInterval(timerInterval);
  isRunning  = false;
  const mins = parseInt(document.getElementById("focusMinutes").value) || 25;
  focusTime  = mins * 60;
  updateTimerDisplay();
  document.getElementById("startBtn").style.display = "flex";
  document.getElementById("pauseBtn").style.display = "none";
  document.getElementById("timer-label").textContent = "Ready to focus";
};

function updateTimerDisplay() {
  const minutes = Math.floor(focusTime / 60);
  const seconds = focusTime % 60;
  const el = document.getElementById("timerDisplay");
  if (el) el.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}


// ════════════════════════════════════════════════════════════════
// CALENDAR
// ════════════════════════════════════════════════════════════════

function renderCalendar() {
  const year  = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  document.getElementById("monthYear").textContent = currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const firstDay      = new Date(year, month, 1).getDay();
  const daysInMonth   = new Date(year, month + 1, 0).getDate();
  const daysInPrev    = new Date(year, month, 0).getDate();

  let html = "";
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => {
    html += `<div class="day-header">${d}</div>`;
  });

  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="day-cell other-month">${daysInPrev - i}</div>`;
  }

  const today = new Date();
  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    html += `<div class="day-cell ${isToday ? "today" : ""}">${day}</div>`;
  }

  const filled = firstDay + daysInMonth;
  const rem    = (42 - filled > 0) ? 42 - filled : 0;
  for (let day = 1; day <= rem; day++) {
    html += `<div class="day-cell other-month">${day}</div>`;
  }

  document.getElementById("calendarGrid").innerHTML = html;
}

window.previousMonth = () => {
  currentMonth.setMonth(currentMonth.getMonth() - 1);
  renderCalendar();
};

window.nextMonth = () => {
  currentMonth.setMonth(currentMonth.getMonth() + 1);
  renderCalendar();
};


// ════════════════════════════════════════════════════════════════
// ACCOUNT PANEL
// ════════════════════════════════════════════════════════════════

async function refreshAccountPanel() {
  if (!currentUser) return;

  const name  = currentUser.displayName || currentUser.email.split("@")[0];
  const email = currentUser.email;

  // Avatar initials
  const initials = name.substring(0, 2).toUpperCase();
  document.getElementById("acct-avatar-lg").textContent = initials;
  document.getElementById("acct-name").textContent      = name;
  document.getElementById("acct-email").textContent     = email;
  document.getElementById("acct-name-input").value      = currentUser.displayName || "";

  // Member since (from Firebase creationTime)
  const created = currentUser.metadata?.creationTime;
  document.getElementById("acct-since").textContent = created
    ? "Member since " + new Date(created).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";

  // Stats — medications & goals are already in memory
  document.getElementById("stat-meds").textContent       = medications.length;
  document.getElementById("stat-goals").textContent      = goals.length;
  document.getElementById("stat-goals-done").textContent = goals.filter((g) => g.completed).length;

  // Symptom count from Firestore
  try {
    const q    = query(collection(db, "symptom_history"), where("userId", "==", currentUser.uid));
    const snap = await getDocs(q);
    document.getElementById("stat-symptoms").textContent = snap.size;
  } catch (e) {
    document.getElementById("stat-symptoms").textContent = "—";
  }
}

window.saveDisplayName = async () => {
  const newName = document.getElementById("acct-name-input").value.trim();
  if (!newName) { showToast("Please enter a name", "error"); return; }

  const btn = document.querySelector(".btn-save-name");
  btn.disabled = true; btn.textContent = "Saving…";

  try {
    await updateProfile(currentUser, { displayName: newName });
    // Update header
    document.getElementById("user-nm").textContent = newName;
    document.getElementById("user-av").textContent = newName.substring(0, 2).toUpperCase();
    document.getElementById("acct-name").textContent      = newName;
    document.getElementById("acct-avatar-lg").textContent = newName.substring(0, 2).toUpperCase();
    showToast("Name updated ✓", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Save";
  }
};

window.confirmDeleteAccount = () => {
  if (confirm("Are you sure you want to permanently delete your account? This cannot be undone.")) {
    currentUser.delete()
      .then(() => showToast("Account deleted", "success"))
      .catch((e) => showToast("Please sign out and sign back in first, then try again.", "error"));
  }
};


// ════════════════════════════════════════════════════════════════
// GEMINI API KEY
// ════════════════════════════════════════════════════════════════

function getGeminiKey() {
  return localStorage.getItem("mmljinsured_gemini_key") || "";
}

function setGeminiKey(k) {
  localStorage.setItem("mmljinsured_gemini_key", k);
}

window.saveGeminiKey = async () => {
  const val = document.getElementById("gemini-key-input").value.trim();
  if (!val || !val.startsWith("AIza")) {
    showToast("Please enter a valid Gemini key (starts with AIza)", "error");
    return;
  }

  const btn = document.querySelector("#gemini-key-input + .btn-save-name") ||
              document.querySelector(".btn-save-name");
  if (btn) { btn.disabled = true; btn.textContent = "Verifying…"; }

  // Quick test call
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${val}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }], generationConfig: { maxOutputTokens: 5 } }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
  } catch (e) {
    showToast("Key error: " + e.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "Save"; }
    return;
  }

  setGeminiKey(val);
  updateApikeyStatus();
  showToast("Gemini API key saved ✓", "success");
  if (btn) { btn.disabled = false; btn.textContent = "Save"; }
};

function updateApikeyStatus() {
  const el  = document.getElementById("apikey-status");
  const inp = document.getElementById("gemini-key-input");
  if (!el) return;
  const key = getGeminiKey();
  if (key) {
    el.innerHTML = `<span class="apikey-badge saved">✓ Key saved — AI Chat is active</span>`;
    if (inp) inp.placeholder = "••••••••••••••••••••••••";
  } else {
    el.innerHTML = `<span class="apikey-badge missing">No key saved yet</span>`;
  }
}

async function callGemini(messages) {
  const key = getGeminiKey();
  if (!key) throw new Error("No API key set. Please add your Gemini key in My Account.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: messages,
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
        systemInstruction: {
          parts: [{
            text: `You are a compassionate and knowledgeable health assistant for the MMLJInsured app. You handle two types of requests:

━━━ SYMPTOM TRIAGE ━━━
When a user describes symptoms, ALWAYS ask 1–3 targeted follow-up questions before giving advice, unless symptoms are clearly emergency-level. Then provide a clear tiered recommendation:
  🟢 MILD — Self-care at home (drink water, rest, OTC meds, monitor)
  🟡 MODERATE — Monitor closely, see doctor if it persists or worsens
  🟠 SERIOUS — See a doctor soon (within 24–48 hours)
  🔴 EMERGENCY — Call 911 or go to the ER immediately

Emergency red flags (escalate immediately): chest pain with breathing difficulty, sudden severe headache, stroke signs, severe allergic reaction, uncontrolled bleeding, loss of consciousness.

━━━ MEDICATION CHECKS ━━━
When a user reports a specific medication for review, provide a structured check covering:
1. **Dosage & Frequency** — Is it within standard clinical ranges? Flag anything unusual.
2. **Side Effects & Warnings** — Key side effects and important warnings the patient should know.
3. **Drug Interactions** — Check against any other listed medications. Rate severity: Minor / Moderate / Major / Contraindicated. Name the specific drugs involved.
4. **Procedure** — How to take it correctly (with food, with water, timing gaps, avoid certain foods/drinks like grapefruit or alcohol, avoid sunlight, etc.)
5. **Red Flags** — Symptoms or signs that should prompt the patient to contact their doctor immediately.
6. **Overall verdict** — 🟢 Looks fine / 🟡 Some concerns / 🟠 See your doctor / 🔴 Contact doctor urgently.

━━━ STYLE RULES ━━━
- Be warm, clear, and precise — never alarmist unless truly warranted
- Use bold headers (**like this**) to separate sections
- Keep paragraphs short — no walls of text
- NEVER give a definitive diagnosis
- Always remind users to consult their doctor or pharmacist for serious concerns`
          }]
        }
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response.";
}


// ════════════════════════════════════════════════════════════════
// AI CHAT
// ════════════════════════════════════════════════════════════════

let chatHistory  = [];   // [{role, parts:[{text}]}]
let chatBusy     = false;

function initChat() {
  const key = getGeminiKey();
  document.getElementById("chat-no-key").style.display    = key ? "none"  : "flex";
  document.getElementById("chat-container").style.display = key ? "flex"  : "none";
  if (!key) return;

  if (chatHistory.length === 0) {
    const name = currentUser?.displayName || currentUser?.email?.split("@")[0] || "there";
    appendBotMessage(`Hi ${name}! 👋 I'm your Health AI Assistant.\n\nDescribe your symptoms to me and I'll ask a few questions, then give you a clear recommendation — from simple home remedies like drinking more water 🟢 all the way to seeking emergency care 🔴 if needed.\n\nWhat's going on today?`);
  }
}

function appendBotMessage(text) {
  hideSuggestions();
  const wrap = document.getElementById("chat-messages");
  const div  = document.createElement("div");
  div.className = "chat-msg bot";
  div.innerHTML = `
    <div class="cmsg-avatar">🤖</div>
    <div class="cmsg-bubble bot-bubble">${formatChatText(text)}</div>
  `;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function appendUserMessage(text) {
  const wrap     = document.getElementById("chat-messages");
  const initials = (currentUser?.displayName || "U").substring(0, 2).toUpperCase();
  const div      = document.createElement("div");
  div.className  = "chat-msg user";
  div.innerHTML  = `
    <div class="cmsg-bubble user-bubble">${escapeHtml(text)}</div>
    <div class="cmsg-avatar user-av-sm">${initials}</div>
  `;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function showTyping() {
  const wrap = document.getElementById("chat-messages");
  const div  = document.createElement("div");
  div.className = "chat-msg bot";
  div.id = "chat-typing";
  div.innerHTML = `
    <div class="cmsg-avatar">🤖</div>
    <div class="cmsg-bubble bot-bubble typing-bubble">
      <span></span><span></span><span></span>
    </div>
  `;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function hideTyping() {
  document.getElementById("chat-typing")?.remove();
}

function hideSuggestions() {
  const s = document.getElementById("chat-suggestions");
  if (s) s.style.display = "none";
}

function formatChatText(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function escapeHtml(t) {
  return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

window.sendSuggestion = (btn) => {
  const text = btn.textContent.trim();
  document.getElementById("chat-input").value = text;
  sendChatMessage();
};

window.sendChatMessage = async () => {
  const input = document.getElementById("chat-input");
  const text  = input.value.trim();
  if (!text || chatBusy) return;

  input.value = "";
  input.style.height = "auto";
  appendUserMessage(text);
  chatHistory.push({ role: "user", parts: [{ text }] });

  chatBusy = true;
  document.getElementById("chat-send-btn").disabled = true;
  showTyping();

  try {
    const reply = await callGemini(chatHistory);
    chatHistory.push({ role: "model", parts: [{ text: reply }] });
    hideTyping();
    appendBotMessage(reply);
  } catch (e) {
    hideTyping();
    appendBotMessage("⚠️ " + e.message);
  } finally {
    chatBusy = false;
    document.getElementById("chat-send-btn").disabled = false;
    input.focus();
  }
};

window.chatKeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
};

window.autoResizeChat = (el) => {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 140) + "px";
};

window.clearChat = () => {
  chatHistory = [];
  document.getElementById("chat-messages").innerHTML = "";
  document.getElementById("chat-suggestions").style.display = "flex";
  const name = currentUser?.displayName || currentUser?.email?.split("@")[0] || "there";
  appendBotMessage(`Hi ${name}! 👋 I'm your Health AI Assistant.\n\nDescribe your symptoms to me and I'll ask a few questions, then give you a clear recommendation — from simple home remedies like drinking more water 🟢 all the way to seeking emergency care 🔴 if needed.\n\nWhat's going on today?`);
};


// ════════════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════════════

window.showToast = (msg, type = "") => {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  setTimeout(() => t.classList.remove("show"), 3200);
};