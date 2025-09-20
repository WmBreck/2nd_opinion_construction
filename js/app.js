window.addEventListener("DOMContentLoaded", () => {
  const leadForm = document.getElementById("lead-form");
  if (!leadForm) return;

  const sb = window.supabase.createClient(
    window.SUPABASE_URL || window.env?.SUPABASE_URL || "",
    window.SUPABASE_ANON_KEY || window.env?.SUPABASE_ANON_KEY || ""
  );

  const statusEl = document.getElementById("status");
  const submitBtn = document.getElementById("submitBtn");
  const done = document.getElementById("done");
  const filesInput = document.getElementById("files");

  async function uploadFiles(leadId) {
    const files = Array.from(filesInput.files || []);
    if (!files.length) return [];
    const uploaded = [];
    for (const f of files.slice(0, 5)) {
      if (f.size > 50 * 1024 * 1024) throw new Error("File too large: " + f.name);
      const path = "leads/" + leadId + "/" + Date.now() + "_" + encodeURIComponent(f.name);
      const { error } = await sb.storage.from("bids").upload(path, f, { upsert: false });
      if (error) throw error;
      uploaded.push({ file_path: path, file_name: f.name, file_size: f.size, file_type: f.type || "application/octet-stream" });
    }
    return uploaded;
  }

  leadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    statusEl.textContent = "Submitting…";
    try {
      const form = new FormData(leadForm);
      const payload = {
        name: (form.get("name")||"").toString().trim(),
        email: (form.get("email")||"").toString().trim(),
        phone: (form.get("phone")||"").toString().trim(),
        city: (form.get("city")||"").toString().trim(),
        zip: (form.get("zip")||"").toString().trim(),
        reason: (form.get("reason")||"").toString(),
        notes: (form.get("notes")||"").toString()
      };

      const { data: leadRow, error: leadErr } = await sb
        .from("leads")
        .insert({
          name: payload.name, email: payload.email, phone: payload.phone,
          city: payload.city, zip: payload.zip, reason: payload.reason,
          notes: payload.notes, status: "new"
        })
        .select()
        .single();
      if (leadErr) throw leadErr;

      const uploaded = await uploadFiles(leadRow.id);
      if (uploaded.length) {
        const rows = uploaded.map(u => ({ lead_id: leadRow.id, ...u }));
        const { error: upErr } = await sb.from("uploads").insert(rows);
        if (upErr) throw upErr;
      }

      const res = await fetch("/.netlify/functions/notify_new_lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadRow.id })
      });
      if (!res.ok) throw new Error("notify_new_lead failed: " + (await res.text()));

      document.getElementById("lead-card").querySelector("form").classList.add("hidden");
      done.classList.remove("hidden");
      statusEl.textContent = "";
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Sorry—something went wrong. Please try again or call (864) 660-9913.";
    } finally {
      submitBtn.disabled = false;
    }
  });
});
