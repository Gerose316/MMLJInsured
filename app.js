// ═══════════════════════════════════════════════════════════════
// app.js — CareAssist
// ═══════════════════════════════════════════════════════════════

import { initializeApp }          from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         signOut, onAuthStateChanged, updateProfile }
                                  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy,
         getDocs, doc, setDoc, deleteDoc }
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

// ── Gemini config ─────────────────────────────────────────────
// Key is stored per-user in localStorage using their Firebase UID.
// Falls back to a global key if user-scoped key not found.

function getGeminiKeyStorageKey() {
  return currentUser ? `ca_gemini_key_${currentUser.uid}` : "ca_gemini_key_global";
}

function getGeminiKey() {
  return localStorage.getItem(getGeminiKeyStorageKey()) || localStorage.getItem("ca_gemini_key_global") || "";
}

function hasGeminiKey() {
  return !!getGeminiKey();
}

function persistGeminiKey(key) {
  localStorage.setItem(getGeminiKeyStorageKey(), key);
  // Also save globally so it survives user switches
  localStorage.setItem("ca_gemini_key_global", key);
}

async function callGemini(prompt, temperature = 0.3, maxTokens = 1024) {
  const key = getGeminiKey();
  if (!key) {
    showApiKeyScreen();
    throw new Error("No Gemini API key set. Please enter your key.");
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ── App state ─────────────────────────────────────────────────
let currentUser  = null;
let selectedTags = [];
let medications  = [];
let chatHistory  = [];   // [{role, parts:[{text}]}]
let chatStarted  = false;
let chatBusy     = false;
let activeMedId  = null;


// ════════════════════════════════════════════════════════════════
// INITIALISATION
// ════════════════════════════════════════════════════════════════

function init() {
  const now    = new Date();
  const timeEl = document.getElementById("m-time");
  if (timeEl) {
    timeEl.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
}

// ── API Key Setup Screen ─────────────────────────────────────
function showApiKeyScreen() {
  document.getElementById("auth-screen").style.display   = "none";
  document.getElementById("apikey-screen").style.display = "flex";
  document.getElementById("app-screen").style.display    = "none";
}

function showAppScreen() {
  document.getElementById("auth-screen").style.display   = "none";
  document.getElementById("apikey-screen").style.display = "none";
  document.getElementById("app-screen").style.display    = "block";
}

window.toggleKeyVisibility = () => {
  const inp = document.getElementById("setup-api-key");
  const cb  = document.getElementById("show-key-toggle");
  if (inp) inp.type = cb.checked ? "text" : "password";
};

window.saveSetupApiKey = async () => {
  const v = document.getElementById("setup-api-key")?.value?.trim();
  const errEl = document.getElementById("apikey-err");
  errEl.style.display = "none";
  errEl.textContent = "";

  if (!v || !v.startsWith("AIza")) {
    errEl.textContent = "Please enter a valid Gemini API key (starts with AIza).";
    errEl.style.display = "block";
    return;
  }

  const btn = document.querySelector("#apikey-screen .btn-primary");
  btn.disabled = true;
  btn.textContent = "Verifying key…";

  // Quick validation call
  try {
    const testRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${v}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Hi" }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
      }
    );
    if (!testRes.ok) {
      const err = await testRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${testRes.status}`);
    }
  } catch (e) {
    errEl.textContent = "Key error: " + e.message;
    errEl.style.display = "block";
    btn.disabled = false;
    btn.textContent = "Save & Continue →";
    return;
  }

  persistGeminiKey(v);
  btn.disabled = false;
  btn.textContent = "Save & Continue →";
  showAppScreen();
  init();
  loadMedications();
  loadHistory();
  showToast("Gemini API key saved ✓", "success");
};

// Change key modal (from header button)
window.showChangeKeyModal = () => {
  document.getElementById("change-key-modal").classList.add("open");
};

window.closeChangeKeyModal = () => {
  document.getElementById("change-key-modal").classList.remove("open");
  document.getElementById("change-key-input").value = "";
};

window.saveChangedKey = async () => {
  const v = document.getElementById("change-key-input")?.value?.trim();
  if (!v) { showToast("Please enter a key", "error"); return; }

  const btn = document.querySelector("#change-key-modal .btn-save");
  btn.disabled = true;
  btn.textContent = "Verifying…";

  try {
    const testRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${v}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Hi" }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
      }
    );
    if (!testRes.ok) {
      const err = await testRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${testRes.status}`);
    }
  } catch (e) {
    showToast("Key error: " + e.message, "error");
    btn.disabled = false;
    btn.textContent = "Save Key";
    return;
  }

  persistGeminiKey(v);
  closeChangeKeyModal();
  btn.disabled = false;
  btn.textContent = "Save Key";
  showToast("API key updated ✓", "success");
};

// Legacy banner — keep hidden
window.saveApiKey = () => {};
function updateApiBanner() {
  const banner = document.getElementById("api-banner");
  if (banner) banner.style.display = "none";
}


// ════════════════════════════════════════════════════════════════
// FIREBASE AUTH
// ════════════════════════════════════════════════════════════════

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;

    const name = user.displayName || user.email.split("@")[0];
    document.getElementById("user-nm").textContent = name;
    document.getElementById("user-av").textContent = name.substring(0, 2).toUpperCase();

    if (!hasGeminiKey()) {
      showApiKeyScreen();
    } else {
      showAppScreen();
      init();
      loadMedications();
      loadHistory();
    }
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
  errEl.textContent = "";
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

  if (!name)         { showAuthErr("Please enter your full name.");         return; }
  if (!email)        { showAuthErr("Please enter your email address.");     return; }
  if (!pw)           { showAuthErr("Please choose a password.");            return; }
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
  document.getElementById("nav-"   + name).classList.add("active");
  if (name === "chat") initChat();
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
// SYMPTOM ANALYSIS  (direct Gemini call)
// ════════════════════════════════════════════════════════════════

window.analyzeSymptoms = async () => {
  const desc     = document.getElementById("symptom-text").value.trim();
  const duration = document.getElementById("sym-duration").value;
  const severity = document.getElementById("sym-severity").value;

  if (!desc && selectedTags.length === 0) {
    showToast("Please describe your symptoms", "error");
    return;
  }

  const tagStr   = selectedTags.join(", ");
  const fullDesc = [desc, tagStr ? `Symptoms ticked: ${tagStr}` : ""].filter(Boolean).join("\n");

  document.getElementById("result-card").style.display = "none";
  document.getElementById("ai-loading").style.display  = "block";
  document.getElementById("analyze-btn").disabled      = true;

  const prompt = `You are a medical AI assistant. Carefully analyze the patient's symptoms below and return a JSON assessment.

PATIENT INPUT:
Symptoms: ${fullDesc}
Duration: ${duration}
Self-rated pain (1-10): ${severity}

Return ONLY a raw valid JSON object. No markdown, no code fences, no backticks, no extra text before or after. Start your response with { and end with }:
{
  "severity_level": "low" | "medium" | "high" | "emergency",
  "severity_label": "Short label e.g. 'Mild Symptoms' / 'Moderate - Monitor Closely' / 'Serious - See Doctor Soon' / 'Emergency - Call 911'",
  "analysis": "2–3 sentences: what the symptoms may suggest and why.",
  "recommendations": "2–3 sentences of practical self-care advice.",
  "see_doctor": "Clear, direct advice on whether and how urgently to see a doctor.",
  "medications": [
    { "name": "OTC medication name and dose", "note": "when/how to take it" },
    { "name": "OTC medication name and dose", "note": "when/how to take it" }
  ],
  "emergency": true | false
}

RULES:
- emergency=true ONLY for: suspected heart attack, stroke, anaphylaxis, severe breathing difficulty, loss of consciousness, uncontrolled bleeding
- severity_level "high" = needs doctor soon (not necessarily ER)
- medications must be common, available OTC medications appropriate for the symptoms
- If symptoms are clearly emergency, set severity_level="emergency" AND emergency=true
- Always be cautious — err on the side of recommending medical care`;

  try {
    const rawText   = await callGemini(prompt, 0.3, 1024);
    // Strip markdown fences if present, then extract JSON
    const cleaned   = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI returned an unexpected response format. Please try again.");
    const result = JSON.parse(jsonMatch[0]);

    renderResult(result);

    await addDoc(collection(db, "symptom_history"), {
      userId:         currentUser.uid,
      symptoms:       fullDesc.substring(0, 300),
      duration,
      severity_input: severity,
      result,
      timestamp:      new Date(),
    });

    loadHistory();

  } catch (e) {
    showToast("Error: " + e.message, "error");
    console.error(e);
  } finally {
    document.getElementById("ai-loading").style.display = "none";
    document.getElementById("analyze-btn").disabled     = false;
  }
};

function renderResult(r) {
  const card = document.getElementById("result-card");
  card.style.display = "block";

  document.getElementById("em-bar").style.display = r.emergency ? "flex" : "none";

  const bar = document.getElementById("sev-bar");
  const lvl = r.severity_level === "emergency" ? "high" : r.severity_level;
  bar.className = `severity-bar sev-${lvl}`;

  const icons  = { low: "✅", medium: "⚠️", high: "🔴", emergency: "🚨" };
  const badges = { low: "LOW", medium: "MODERATE", high: "HIGH", emergency: "EMERGENCY" };

  document.getElementById("sev-icon").textContent  = icons[r.severity_level]  || "⚠️";
  document.getElementById("sev-label").textContent = r.severity_label;
  document.getElementById("sev-badge").textContent = badges[r.severity_level] || r.severity_level.toUpperCase();

  document.getElementById("res-analysis").textContent = r.analysis;
  document.getElementById("res-recs").textContent     = r.recommendations;
  document.getElementById("res-doctor").textContent   = r.see_doctor;

  const medList = document.getElementById("res-meds");
  medList.innerHTML = "";
  (r.medications || []).forEach((m) => {
    const el = document.createElement("div");
    el.className = "med-chip";
    el.innerHTML = `
      <div class="med-chip-info">
        <div class="mc-name">💊 ${m.name}</div>
        <div class="mc-note">${m.note}</div>
      </div>
      <button class="btn-track" onclick="quickAddMed('${m.name.replace(/'/g, "")}')">+ Track</button>
    `;
    medList.appendChild(el);
  });

  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

window.callEmergency = () => {
  if (confirm("This will call 911 (emergency services). Continue?"))
    window.location.href = "tel:911";
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
    userId:    currentUser.uid,
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

window.quickAddMed = async (name) => {
  await addDoc(collection(db, "medications"), {
    userId:    currentUser.uid,
    name, dosage: "1 dose", frequency: "As needed (PRN)",
    nextDose: "", notes: "Added from symptom checker", createdAt: new Date(),
  });
  showToast(`${name} added to medications ✓`, "success");
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

window.deleteMedFromDetail = async () => {
  if (!activeMedId) return;
  if (!confirm("Remove this medication?")) return;
  await deleteDoc(doc(db, "medications", activeMedId));
  closeMedDetailModal();
  showToast("Medication removed");
  loadMedications();
};

window.runMedSymptomCheck = () => {
  const med = medications.find((m) => m.id === activeMedId);
  if (!med) return;
  closeMedDetailModal();
  showPanel("symptoms");
  const txt = document.getElementById("symptom-text");
  txt.value = `I am currently taking ${med.name} (${med.dosage}, ${med.frequency}). Please check if my symptoms are related to or affected by this medication.`;
  txt.focus();
  showToast(`Symptom checker ready for ${med.name}`, "success");
};


// ════════════════════════════════════════════════════════════════
// SYMPTOM HISTORY
// ════════════════════════════════════════════════════════════════

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

    if (snap.empty) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="ei">📋</div>
          <p>No checks yet.<br>Your symptom history will appear here.</p>
        </div>`;
      return;
    }

    list.innerHTML = "";
    snap.forEach((d) => {
      const data = d.data();
      const ts   = data.timestamp?.toDate?.() || new Date();
      const lvl  = data.result?.severity_level || "low";
      const el   = document.createElement("div");
      el.className = "hist-item";
      el.innerHTML = `
        <div class="hist-top">
          <span class="hist-date">
            ${ts.toLocaleDateString()} · ${ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span class="sev-pill ${lvl === "emergency" ? "high" : lvl}">
            ${data.result?.severity_label || lvl}
          </span>
        </div>
        <div class="hist-text">${data.symptoms || "No description"}</div>
      `;
      list.appendChild(el);
    });
  } catch (e) {
    console.error("History load error:", e);
  }
}


// ════════════════════════════════════════════════════════════════
// AI CHAT  (multi-turn Gemini)
// ════════════════════════════════════════════════════════════════

const CHAT_SYSTEM = `You are CareAssist, a friendly and knowledgeable AI health assistant.
You help users understand their symptoms, medications, and general health questions.
Be empathetic, clear, and always recommend consulting a doctor for serious concerns.
Keep responses concise and conversational. Never diagnose definitively.`;

function initChat() {
  if (chatStarted) return;
  chatStarted = true;
  chatHistory = [];
  const name  = currentUser?.displayName || currentUser?.email?.split("@")[0] || "there";
  appendAiMessage(`Hi ${name}! 👋 How are you feeling today? Tell me what's going on and I'll do my best to help.`);
}

function appendAiMessage(text, showAnalysisBtn = false) {
  const wrap = document.getElementById("chat-messages");
  const msg  = document.createElement("div");
  msg.className = "chat-msg ai";
  msg.innerHTML = `
    <div class="chat-msg-avatar">🩺</div>
    <div>
      <div class="chat-bubble">${text.replace(/\n/g, "<br>")}</div>
      ${showAnalysisBtn ? `<button class="chat-action-btn" onclick="showPanel('symptoms')">✦ Run Full Symptom Analysis</button>` : ""}
    </div>
  `;
  wrap.appendChild(msg);
  wrap.scrollTop = wrap.scrollHeight;
}

function appendUserMessage(text) {
  const wrap     = document.getElementById("chat-messages");
  const initials = (currentUser?.displayName || "U").substring(0, 2).toUpperCase();
  const msg      = document.createElement("div");
  msg.className  = "chat-msg user";
  msg.innerHTML  = `
    <div class="chat-msg-avatar">${initials}</div>
    <div class="chat-bubble">${text.replace(/\n/g, "<br>")}</div>
  `;
  wrap.appendChild(msg);
  wrap.scrollTop = wrap.scrollHeight;
}

function showTypingIndicator() {
  const wrap = document.getElementById("chat-messages");
  const el   = document.createElement("div");
  el.className = "chat-msg ai";
  el.id = "chat-typing-row";
  el.innerHTML = `
    <div class="chat-msg-avatar">🩺</div>
    <div class="chat-typing"><span></span><span></span><span></span></div>
  `;
  wrap.appendChild(el);
  wrap.scrollTop = wrap.scrollHeight;
}

function removeTypingIndicator() {
  document.getElementById("chat-typing-row")?.remove();
}

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
  showTypingIndicator();

  try {
    const key = getGeminiKey();
    const contents = [
      { role: "user",  parts: [{ text: CHAT_SYSTEM + "\n\nBegin conversation." }] },
      { role: "model", parts: [{ text: "Understood. I am CareAssist, ready to help." }] },
      ...chatHistory,
    ];

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const data  = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I could not generate a response.";

    chatHistory.push({ role: "model", parts: [{ text: reply }] });

    removeTypingIndicator();
    const suggestAnalysis = /full analysis|symptom check|run.*analysis/i.test(reply);
    appendAiMessage(reply, suggestAnalysis);

  } catch (e) {
    removeTypingIndicator();
    appendAiMessage("Sorry, I had trouble connecting to the AI service. Please try again.");
    console.error("Chat error:", e);
  } finally {
    chatBusy = false;
    document.getElementById("chat-send-btn").disabled = false;
    input.focus();
  }
};

window.chatKeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
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