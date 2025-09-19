(() => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.__ENV || {};
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing Supabase environment configuration. Set window.__ENV with SUPABASE_URL and SUPABASE_ANON_KEY.');
  }

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const MAX_FILES = 5;
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
  const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg'];
  const RESEND_INTERVAL_MS = 45 * 1000;

  const modal = document.getElementById('intake-modal');
  const steps = {
    contact: modal.querySelector('[data-step="contact"]'),
    otp: modal.querySelector('[data-step="otp"]'),
    upload: modal.querySelector('[data-step="upload"]'),
    success: modal.querySelector('[data-step="success"]'),
  };

  const contactForm = document.getElementById('contact-form');
  const otpForm = document.getElementById('otp-form');
  const resendButton = document.getElementById('resend-otp');
  const uploadForm = document.getElementById('upload-form');
  const fileInput = document.getElementById('file-input');
  const fileDrop = document.getElementById('file-drop');
  const fileSelectButton = document.getElementById('file-select');
  const uploadList = document.getElementById('upload-list');
  const otpEmailDisplay = modal.querySelector('[data-otp-email]');

  const state = {
    contact: null,
    lastOtpSentAt: 0,
    user: null,
    leadId: null,
    fileQueue: [],
    uploadsComplete: false,
  };

  const ctaButton = document.getElementById('cta-button');
  ctaButton?.addEventListener('click', () => {
    console.log('hero_cta_click');
    openModal();
  });

  modal.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', closeModal);
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('active')) {
      closeModal();
    }
  });

  contactForm.addEventListener('submit', handleContactSubmit);
  otpForm.addEventListener('submit', handleOtpSubmit);
  resendButton.addEventListener('click', handleResendOtp);
  uploadForm.addEventListener('submit', handleUploadSubmit);
  fileSelectButton.addEventListener('click', () => fileInput.click());
  uploadList.addEventListener('click', handleUploadListClick);
  fileInput.addEventListener('change', () => {
    if (fileInput.files) {
      addFiles(Array.from(fileInput.files));
      fileInput.value = '';
    }
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    fileDrop.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      fileDrop.classList.add('dragging');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    fileDrop.addEventListener(eventName, (event) => {
      event.preventDefault();
      fileDrop.classList.remove('dragging');
    });
  });

  fileDrop.addEventListener('drop', (event) => {
    const droppedFiles = event.dataTransfer?.files;
    if (droppedFiles) {
      addFiles(Array.from(droppedFiles));
    }
  });

  function openModal() {
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    resetState();
    showStep('contact');
  }

  function closeModal() {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    resetState();
  }

  function showStep(stepName) {
    Object.entries(steps).forEach(([name, element]) => {
      if (!element) return;
      const isActive = name === stepName;
      element.hidden = !isActive;
    });
  }

  function resetState() {
    contactForm.reset();
    otpForm.reset();
    uploadForm.reset();
    clearStatuses(contactForm);
    clearStatuses(otpForm);
    clearStatuses(uploadForm);
    uploadList.innerHTML = '';
    state.contact = null;
    state.lastOtpSentAt = 0;
    state.user = null;
    state.leadId = null;
    state.fileQueue = [];
    state.uploadsComplete = false;
  }

  async function handleContactSubmit(event) {
    event.preventDefault();
    clearStatuses(contactForm);

    const formData = new FormData(contactForm);
    const payload = {
      name: formData.get('name')?.toString().trim() ?? '',
      email: formData.get('email')?.toString().trim().toLowerCase() ?? '',
      phone: formData.get('phone')?.toString().trim() ?? '',
      city: formData.get('city')?.toString().trim() ?? '',
      zip: formData.get('zip')?.toString().trim() ?? '',
      reason: formData.get('reason')?.toString().trim() ?? '',
      project_type: formData.get('project_type')?.toString().trim() ?? '',
      budget_range: formData.get('budget_range')?.toString().trim() ?? '',
      notes: formData.get('notes')?.toString().trim() ?? '',
      consent: formData.get('consent') === 'on',
    };

    const errors = {};
    if (!payload.name) errors.name = 'Please enter your name.';
    if (!payload.email || !isValidEmail(payload.email)) errors.email = 'Enter a valid email.';
    if (!payload.phone) errors.phone = 'Phone number is required.';
    if (!payload.reason) errors.reason = 'Choose the main reason for the review.';
    if (!payload.consent) errors.consent = 'You must agree before continuing.';

    if (Object.keys(errors).length > 0) {
      Object.entries(errors).forEach(([field, message]) => setFieldError(contactForm, field, message));
      setFormStatus(contactForm, 'Please fix the highlighted fields.', 'error');
      return;
    }

    setLoading(contactForm, true, 'Sending verification code...');

    const { error } = await supabase.auth.signInWithOtp({
      email: payload.email,
      options: {
        shouldCreateUser: true,
      },
    });

    setLoading(contactForm, false);

    if (error) {
      console.error('OTP send error', error);
      setFormStatus(contactForm, error.message || 'Unable to send verification code.', 'error');
      return;
    }

    state.contact = payload;
    state.lastOtpSentAt = Date.now();
    otpEmailDisplay.textContent = payload.email;
    setFormStatus(contactForm, 'Verification code sent. Check your inbox (and spam).', 'success');
    console.log('otp_sent', { email: payload.email });
    showStep('otp');
  }

  async function handleResendOtp() {
    if (!state.contact?.email) {
      return;
    }

    const now = Date.now();
    if (now - state.lastOtpSentAt < RESEND_INTERVAL_MS) {
      const seconds = Math.ceil((RESEND_INTERVAL_MS - (now - state.lastOtpSentAt)) / 1000);
      setFormStatus(otpForm, `Please wait ${seconds} seconds before requesting another code.`, 'error');
      return;
    }

    resendButton.disabled = true;
    setLoading(otpForm, true, 'Resending code...');

    const { error } = await supabase.auth.signInWithOtp({
      email: state.contact.email,
      options: { shouldCreateUser: true },
    });

    setLoading(otpForm, false);
    resendButton.disabled = false;

    if (error) {
      console.error('OTP resend error', error);
      setFormStatus(otpForm, error.message || 'Unable to resend code.', 'error');
      return;
    }

    state.lastOtpSentAt = Date.now();
    setFormStatus(otpForm, 'New code sent. It may take a minute to arrive.', 'success');
    console.log('otp_sent', { email: state.contact.email, resend: true });
  }

  async function handleOtpSubmit(event) {
    event.preventDefault();
    clearStatuses(otpForm);

    if (!state.contact) {
      setFormStatus(otpForm, 'Contact details missing. Please start again.', 'error');
      showStep('contact');
      return;
    }

    const formData = new FormData(otpForm);
    const token = formData.get('otp')?.toString().trim() ?? '';

    if (!/^[0-9]{6}$/.test(token)) {
      setFieldError(otpForm, 'otp', 'Enter the six-digit code.');
      setFormStatus(otpForm, 'Verification code must be six digits.', 'error');
      return;
    }

    setLoading(otpForm, true, 'Verifying...');

    const { data, error } = await supabase.auth.verifyOtp({
      email: state.contact.email,
      token,
      type: 'email',
    });

    if (error || !data?.user) {
      console.error('OTP verify error', error);
      setLoading(otpForm, false);
      setFormStatus(otpForm, error?.message || 'Incorrect code. Please try again.', 'error');
      return;
    }

    const user = data.user;
    state.user = user;

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .insert([
        {
          user_id: user.id,
          name: state.contact.name,
          email: state.contact.email,
          phone: state.contact.phone,
          city: state.contact.city || null,
          zip: state.contact.zip || null,
          reason: state.contact.reason,
          project_type: state.contact.project_type || null,
          budget_range: state.contact.budget_range || null,
          notes: state.contact.notes || null,
          consent: state.contact.consent,
        },
      ])
      .select()
      .single();

    setLoading(otpForm, false);

    if (leadError || !lead) {
      console.error('Lead insert error', leadError);
      setFormStatus(otpForm, leadError?.message || 'Unable to save your details. Please try again.', 'error');
      return;
    }

    state.leadId = lead.id;
    console.log('lead_created', { lead_id: lead.id });
    showStep('upload');
  }

  function addFiles(files) {
    clearStatuses(uploadForm);

    const newItems = [];
    for (const file of files) {
      if (state.fileQueue.length + newItems.length >= MAX_FILES) {
        setFormStatus(uploadForm, `You can attach up to ${MAX_FILES} files.`, 'error');
        break;
      }

      if (file.size > MAX_FILE_SIZE) {
        setFormStatus(uploadForm, `${file.name} is over 50 MB.`, 'error');
        continue;
      }

      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED_EXTENSIONS.includes(extension)) {
        setFormStatus(uploadForm, `${file.name} is not an accepted file type.`, 'error');
        continue;
      }

      const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      newItems.push({
        id,
        file,
        status: 'pending',
        path: null,
      });
    }

    if (newItems.length > 0) {
      state.fileQueue.push(...newItems);
      renderUploadList();
    }
  }

  function renderUploadList() {
    uploadList.innerHTML = '';
    if (state.fileQueue.length === 0) {
      return;
    }

    for (const item of state.fileQueue) {
      const li = document.createElement('li');
      li.className = `upload-item ${item.status}`.trim();
      li.dataset.id = item.id;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = `${item.file.name} (${formatBytes(item.file.size)})`;

      const statusSpan = document.createElement('span');
      statusSpan.textContent = statusLabel(item.status);
      statusSpan.className = 'upload-status';

      const actions = document.createElement('div');
      actions.className = 'upload-actions';

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = 'Remove';
      removeButton.className = 'button button--ghost button--sm';
      removeButton.dataset.action = 'remove';
      removeButton.dataset.id = item.id;
      removeButton.disabled = item.status !== 'pending';

      actions.appendChild(statusSpan);
      actions.appendChild(removeButton);

      li.appendChild(nameSpan);
      li.appendChild(actions);
      uploadList.appendChild(li);
    }
  }

  async function handleUploadSubmit(event) {
    event.preventDefault();
    clearStatuses(uploadForm);

    if (!state.user || !state.leadId) {
      setFormStatus(uploadForm, 'Please verify your email again.', 'error');
      showStep('contact');
      return;
    }

    if (state.fileQueue.length === 0) {
      setFormStatus(uploadForm, 'Add at least one file before submitting.', 'error');
      return;
    }

    setLoading(uploadForm, true, 'Uploading files...');

    let hasError = false;
    for (const item of state.fileQueue) {
      if (item.status === 'success') {
        continue;
      }

      updateFileStatus(item.id, 'uploading');

      const sanitizedName = sanitizeFilename(item.file.name);
      const storagePath = `${state.user.id}/${state.leadId}/${sanitizedName}`;

      const { data: stored, error: uploadError } = await supabase.storage
        .from('bids')
        .upload(storagePath, item.file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError || !stored) {
        console.error('Storage upload error', uploadError);
        updateFileStatus(item.id, 'error');
        hasError = true;
        continue;
      }

      const { error: insertError } = await supabase
        .from('uploads')
        .insert([
          {
            user_id: state.user.id,
            lead_id: state.leadId,
            file_path: stored.path,
            file_name: item.file.name,
            file_type: item.file.type || null,
            file_size: item.file.size,
          },
        ]);

      if (insertError) {
        console.error('Upload record error', insertError);
        updateFileStatus(item.id, 'error');
        hasError = true;
        continue;
      }

      item.path = stored.path;
      updateFileStatus(item.id, 'success');
    }

    setLoading(uploadForm, false);

    if (hasError) {
      setFormStatus(uploadForm, 'Some files could not be uploaded. Fix the errors and try again.', 'error');
      return;
    }

    state.uploadsComplete = true;
    console.log('upload_complete', { lead_id: state.leadId, file_count: state.fileQueue.length });

    const { error: notifyError } = await supabase.functions.invoke('notify_new_lead', {
      body: { lead_id: state.leadId },
    });

    if (notifyError) {
      console.error('Edge function notify error', notifyError);
      setFormStatus(uploadForm, 'Files uploaded, but we could not send the notification automatically. We will follow up shortly.', 'error');
    } else {
      console.log('notify_sent', { lead_id: state.leadId });
      setFormStatus(uploadForm, 'Files uploaded. Thanks for sharing your plans.', 'success');
    }

    showStep('success');
  }

  function updateFileStatus(id, status) {
    const item = state.fileQueue.find((entry) => entry.id === id);
    if (item) {
      item.status = status;
    }
    const element = uploadList.querySelector(`[data-id="${safeCss(id)}"]`);
    if (element) {
      element.className = `upload-item ${status}`.trim();
      const statusSpan = element.querySelector('.upload-status');
      if (statusSpan) {
        statusSpan.textContent = statusLabel(status);
      }
      const removeButton = element.querySelector('[data-action="remove"]');
      if (removeButton) {
        removeButton.disabled = status !== 'pending';
      }
    }
  }

  function setFieldError(form, fieldName, message) {
    const errorEl = form.querySelector(`[data-error-for="${fieldName}"]`);
    if (errorEl) {
      errorEl.textContent = message;
    }
  }

  function clearStatuses(form) {
    form.querySelectorAll('.field-error').forEach((el) => (el.textContent = ''));
    const statusEl = form.querySelector('[data-status]');
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.remove('error', 'success');
    }
  }

  function setFormStatus(form, message, tone = 'info') {
    const statusEl = form.querySelector('[data-status]');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.remove('error', 'success');
    if (tone === 'error') {
      statusEl.classList.add('error');
    } else if (tone === 'success') {
      statusEl.classList.add('success');
    }
  }

  function setLoading(form, isLoading, message) {
    const submit = form.querySelector('[data-submit]');
    if (submit) {
      submit.disabled = isLoading;
    }
    if (message) {
      setFormStatus(form, message, isLoading ? 'info' : undefined);
    }
  }

  function formatBytes(bytes) {
    const thresh = 1024;
    if (Math.abs(bytes) < thresh) {
      return `${bytes} B`;
    }
    const units = ['KB', 'MB', 'GB', 'TB'];
    let u = -1;
    let value = bytes;
    do {
      value /= thresh;
      ++u;
    } while (Math.abs(value) >= thresh && u < units.length - 1);
    return `${value.toFixed(1)} ${units[u]}`;
  }

  function statusLabel(status) {
    switch (status) {
      case 'pending':
        return 'Ready to upload';
      case 'uploading':
        return 'Uploading...';
      case 'success':
        return 'Uploaded';
      case 'error':
        return 'Error';
      default:
        return '';
    }
  }

  function sanitizeFilename(filename) {
    const timestamp = Date.now();
    const clean = filename
      .toLowerCase()
      .replace(/[^a-z0-9.\-\s_]/g, '')
      .replace(/\s+/g, '-');
    const finalName = clean || 'file';
    return `${timestamp}-${finalName}`;
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function safeCss(value) {
    const str = String(value);
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(str);
    }
    return str.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  }

  function handleUploadListClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    if (target.dataset.action === 'remove') {
      const id = target.dataset.id;
      if (!id) return;
      state.fileQueue = state.fileQueue.filter((item) => item.id !== id);
      renderUploadList();
    }
  }
})();
