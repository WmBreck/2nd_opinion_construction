// public/app.js
(() => {
  // ---- Supabase init (expects window.ENV in public/env.js) ----
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.ENV || {};
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in env.js");
    return;
  }
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---- Elements ----
  const intakeModal = document.getElementById("intake-modal");
  const stepContact = intakeModal?.querySelector('[data-step="contact"]');
  const stepOtp     = intakeModal?.querySelector('[data-step="otp"]');
  const stepUpload  = intakeModal?.querySelector('[data-step="upload"]');
  const stepSuccess = intakeModal?.querySelector('[data-step="success"]');

  const contactForm = document.getElementById("contact-form");
  const otpForm     = document.getElementById("otp-form");
  const uploadForm  = document.getElementById("upload-form");

  const otpEmailEl  = stepOtp?.querySelector("[data-otp-email]");

  // File UI
  const fileDrop    = document.getElementById("file-drop");
  const fileInput   = document.getElementById("file-input");
  const fileSelect  = document.getElementById("file-select");
  const uploadList  = document.getElementById("upload-list");

  // ---- Local state ----
  const state = {
    contact: null,        // { name, email, phone, city, zip, project_type, budget_range, reason, notes, consent }
    pendingFiles: [],     // File[]
    userIdentity: null    // { email }
  };

  // ---- Helpers ----
  function showStep(stepEl) {
    [stepContact, stepOtp, stepUpload, stepSuccess].forEach(el => {
      if (!el) return;
      el.hidden = el !== stepEl;
    });
  }

  function setStatus(formEl, msg, isError = false) {
    const status = formEl?.querySelector('[data-status]');
    if (!status) return;
    status.textContent = msg || "";
    status.classList.toggle("error", !!isError);
    status.classList.toggle("success", !isError && !!msg);
  }

  function setFieldError(formEl, fieldName, msg) {
    const errorEl = formEl?.querySelector(`[data-error-for="${fieldName}"]`);
    if (errorEl) errorEl.textContent = msg || "";
  }

  function clearFieldErrors(formEl) {
    formEl?.querySelectorAll(".field-error").forEach(el => el.textContent = "");
  }

  function validateContact(form) {
    clearFieldErrors(form);
    const formData = new FormData(form);
    const name  = formData.get("name")?.trim();
    const email = formData.get("email")?.trim();
    const phone = formData.get("phone")?.trim();
    const consent = formData.get("consent");
    let ok = true;

    if (!name)  { setFieldError(form, "name", "Required"); ok = false; }
    if (!email) { setFieldError(form, "email", "Required"); ok = false; }
    if (!phone) { setFieldError(form, "phone", "Required"); ok = false; }
    if (!consent){ setFieldError(form, "consent", "Required"); ok = false; }

    if (!ok) return null;

    return {
      name,
      email,
      phone,
      city: formData.get("city")?.trim(),
      zip: formData.get("zip")?.trim(),
      project_type: formData.get("project_type") || "",
      budget_range: formData.get("budget_range") || "",
      reason: formData.get("reason") || "",
      notes: formData.get("notes")?.trim() || "",
      consent: true
    };
  }

  function populateUploadList() {
    uploadList.innerHTML = "";
    state.pendingFiles.forEach((file, idx) => {
      const li = document.createElement("li");
      li.className = "upload-item";
      li.dataset.index = String(idx);
      li.innerHTML = `
        <span>${file.name} • ${(file.size/1024/1024).toFixed(1)} MB</span>
        <div class="upload-actions">
          <button type="button" class="button button--sm" data-remove>Remove</button>
        </div>
      `;
      uploadList.appendChild(li);
    });
  }

  function filesFromDataTransfer(dt) {
    const items = Array.from(dt.items || []);
    const files = items
      .filter(i => i.kind === "file")
      .map(i => i.getAsFile())
      .filter(Boolean);
    return files;
  }

  // ---- Contact step: send email OTP ----
  contactForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const contact = validateContact(contactForm);
    if (!contact) {
      setStatus(contactForm, "Please fix the highlighted fields.", true);
      return;
    }

    setStatus(contactForm, "Sending verification code...");
    try {
      // Send OTP to email
      const { error } = await supabase.auth.signInWithOtp({
        email: contact.email,
        options: {
          data: { name: contact.name, phone: contact.phone },
          shouldCreateUser: true
        }
      });
      if (error) throw error;

      state.contact = contact;
      state.userIdentity = { email: contact.email };
      if (otpEmailEl) otpEmailEl.textContent = contact.email;
      setStatus(contactForm, "");
      showStep(stepOtp);
    } catch (err) {
      console.error(err);
      setStatus(contactForm, "Could not send code. Please check your email and try again.", true);
    }
  });

  // ---- OTP step: verify 6-digit code ----
  otpForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(otpForm);
    setStatus(otpForm, "Verifying code...");
    const formData = new FormData(otpForm);
    const otp = (formData.get("otp") || "").toString().trim();

    if (!otp || !/^\d{6}$/.test(otp)) {
      setFieldError(otpForm, "otp", "Enter the 6-digit code");
      setStatus(otpForm, "Please enter the 6-digit code.", true);
      return;
    }

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: state.userIdentity?.email,
        token: otp,
        type: "email"
      });
      if (error) throw error;
      // Authenticated
      setStatus(otpForm, "");
      showStep(stepUpload);
    } catch (err) {
      console.error(err);
      setFieldError(otpForm, "otp", "Invalid or expired code");
      setStatus(otpForm, "That code didn’t work. Try again or resend.", true);
    }
  });

  // ---- OTP: resend ----
  document.getElementById("resend-otp")?.addEventListener("click", async () => {
    if (!state.userIdentity?.email) return;
    setStatus(otpForm, "Resending code...");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: state.userIdentity.email,
        options: { shouldCreateUser: true }
      });
      if (error) throw error;
      setStatus(otpForm, "Code sent. Check your inbox.");
    } catch (err) {
      console.error(err);
      setStatus(otpForm, "Could not resend code. Try again later.", true);
    }
  });

  // ---- Upload step: local file selection + drag/drop ----
  fileSelect?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    state.pendingFiles.push(...files);
    populateUploadList();
  });

  fileDrop?.addEventListener("dragover", (e) => {
    e.preventDefault();
    fileDrop.classList.add("dragging");
  });
  fileDrop?.addEventListener("dragleave", () => fileDrop.classList.remove("dragging"));
  fileDrop?.addEventListener("drop", (e) => {
    e.preventDefault();
    fileDrop.classList.remove("dragging");
    const files = filesFromDataTransfer(e.dataTransfer);
    state.pendingFiles.push(...files);
    populateUploadList();
  });

  uploadList?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    const li = btn.closest("li.upload-item");
    const idx = Number(li?.dataset.index || "-1");
    if (idx >= 0) {
      state.pendingFiles.splice(idx, 1);
      populateUploadList();
    }
  });

  // ---- Upload submit: store files + contact record ----
  uploadForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.userIdentity?.email) {
      setStatus(uploadForm, "Session expired. Please restart.", true);
      return;
    }

    // Create a row in a table if you want (e.g., 'intakes'); here we'll just attach metadata to file names.
    setStatus(uploadForm, "Uploading files...");

    try {
      // Ensure a 'bids' storage bucket exists in Supabase (public or with RLS as needed).
      const emailSlug = state.userIdentity.email.replace(/[^a-z0-9@._-]/gi, "_");
      const basePath = `bids/${emailSlug}/${Date.now()}`;

      // Upload files (up to 5, enforced by UI text)
      for (let i = 0; i < state.pendingFiles.length; i++) {
        const file = state.pendingFiles[i];
        const path = `${basePath}/${file.name}`;
        const { error } = await supabase.storage.from("bids").upload(path, file, {
          upsert: false
        });
        if (error) throw error;
      }

      // Optionally, store a simple intake record (requires a table + anon insert policy):
      // await supabase.from("intakes").insert([{ ...state.contact, email: state.userIdentity.email, files_path: basePath }]);

      setStatus(uploadForm, "");
      showStep(stepSuccess);
    } catch (err) {
      console.error(err);
      setStatus(uploadForm, "Upload failed. Please try again.", true);
    }
  });

  // Close success -> close modal
  stepSuccess?.querySelector("[data-close]")?.addEventListener("click", () => {
    if (intakeModal) {
      intakeModal.classList.remove("active");
      intakeModal.setAttribute("aria-hidden", "true");
      // reset local state
      state.pendingFiles = [];
      populateUploadList();
    }
  });
})();