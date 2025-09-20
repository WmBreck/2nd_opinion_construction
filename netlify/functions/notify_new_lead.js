import { createClient } from "@supabase/supabase-js";

export default async (req, context) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try {
    const { lead_id } = await req.json();
    if (!lead_id) return new Response("Missing lead_id", { status: 400 });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const OWNER_EMAIL  = process.env.OWNER_EMAIL || "upcountrycontractors@gmail.com";
    const RESEND_KEY   = process.env.RESEND_API_KEY;

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: lead, error: leadErr } = await sb.from("leads").select("*").eq("id", lead_id).single();
    if (leadErr) throw leadErr;

    const { data: files, error: filesErr } = await sb.from("uploads").select("*").eq("lead_id", lead_id);
    if (filesErr) throw filesErr;

    const links = [];
    for (const f of (files || [])) {
      const { data, error } = await sb.storage.from("bids").createSignedUrl(f.file_path, 60 * 60 * 24);
      if (error) throw error;
      links.push({ name: f.file_name, url: data.signedUrl, size: f.file_size });
    }

    const html = `
      <h2>[2nd Opinion Lead] ${lead.name} — ${lead.city} ${lead.zip}</h2>
      <p><strong>Reason:</strong> ${lead.reason}</p>
      <p><strong>Contact:</strong> ${lead.email} · ${lead.phone}</p>
      <p><strong>Notes:</strong> ${lead.notes || "(none)"} </p>
      <hr/>
      <h3>Files</h3>
      <ul>${links.map(l => `<li><a href="${l.url}">${l.name}</a> (${Math.round(l.size/1024)} KB)</li>`).join("") || "<li>(none)</li>"}</ul>
    `;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: "Second Opinion <noreply@2ndopinionconstruction.com>",
        to: [OWNER_EMAIL],
        subject: `[2nd Opinion Lead] ${lead.name} — ${lead.city}`,
        html
      })
    });
    if (!r.ok) throw new Error("Resend failed: " + (await r.text()));

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
