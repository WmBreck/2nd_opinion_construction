import { serve } from "https://deno.land/std@0.204.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const mailFrom = Deno.env.get("MAIL_FROM") ?? "2nd Opinion Construction <no-reply@2ndopinionconstruction.com>";
const mailTo = Deno.env.get("MAIL_TO") ?? "upcountrycontractors@gmail.com";

if (!supabaseUrl) {
  console.error("Missing SUPABASE_URL env var");
  throw new Error("SUPABASE_URL is required");
}

if (!serviceRoleKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY env var");
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
}

if (!resendApiKey) {
  console.error("Missing RESEND_API_KEY env var");
  throw new Error("RESEND_API_KEY is required");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

interface LeadPayload {
  lead_id?: string;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let payload: LeadPayload;
  try {
    payload = await req.json();
  } catch (_err) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const leadId = payload.lead_id;
  if (!leadId) {
    return jsonResponse({ error: "lead_id is required" }, 400);
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (leadError || !lead) {
    console.error("Lead fetch error", leadError);
    return jsonResponse({ error: "Lead not found" }, 404);
  }

  const { data: uploads, error: uploadsError } = await supabase
    .from("uploads")
    .select("*")
    .eq("lead_id", leadId);

  if (uploadsError) {
    console.error("Uploads fetch error", uploadsError);
    return jsonResponse({ error: "Unable to fetch uploads" }, 500);
  }

  const signedUploads: Array<{
    file_name: string;
    file_type: string | null;
    file_size: number | null;
    signedUrl: string | null;
  }> = [];

  if (uploads && uploads.length > 0) {
    for (const upload of uploads) {
      const { data: signed, error: signedError } = await supabase.storage
        .from("bids")
        .createSignedUrl(upload.file_path, 60 * 60 * 24);

      if (signedError) {
        console.error(`Failed to sign URL for ${upload.file_path}`, signedError);
        signedUploads.push({
          file_name: upload.file_name,
          file_type: upload.file_type,
          file_size: upload.file_size,
          signedUrl: null,
        });
        continue;
      }

      signedUploads.push({
        file_name: upload.file_name,
        file_type: upload.file_type,
        file_size: upload.file_size,
        signedUrl: signed?.signedUrl ?? null,
      });
    }
  }

  const subjectParts = ["[2nd Opinion Lead]", lead.name ?? "Unknown"];
  if (lead.city) subjectParts.push(lead.city);
  if (lead.reason) subjectParts.push(lead.reason);
  const subject = subjectParts.filter((part) => part && part.trim().length > 0).join(" - ");

  const leadLines = [
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    `Phone: ${lead.phone}`,
    `City: ${lead.city ?? "-"}`,
    `ZIP: ${lead.zip ?? "-"}`,
    `Reason: ${lead.reason}`,
    `Project Type: ${lead.project_type ?? "-"}`,
    `Budget Range: ${lead.budget_range ?? "-"}`,
    `Status: ${lead.status}`,
    `Notes: ${lead.notes ?? "-"}`,
    `Consent: ${lead.consent ? "true" : "false"}`,
    `Submitted: ${lead.created_at}`,
  ];

  const listUploads = signedUploads.length > 0
    ? signedUploads.map((item, index) => {
      const fileType = item.file_type ? ` (${item.file_type})` : "";
      const size = item.file_size ? ` [${formatBytes(item.file_size)}]` : "";
      const link = item.signedUrl ? item.signedUrl : "(signed URL unavailable)";
      return `${index + 1}. ${item.file_name}${fileType}${size} -> ${link}`;
    }).join("\n")
    : "No files uploaded.";

  const textBody = `${leadLines.join("\n")}\n\nFiles:\n${listUploads}\n`;

  const htmlLines = leadLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const htmlUploads = signedUploads.length > 0
    ? signedUploads.map((item) => {
      const fileType = item.file_type ? ` (${item.file_type})` : "";
      const size = item.file_size ? ` [${formatBytes(item.file_size)}]` : "";
      const displayName = escapeHtml(item.file_name + fileType + size);
      if (item.signedUrl) {
        return `<li><a href="${item.signedUrl}">${displayName}</a></li>`;
      }
      return `<li>${displayName} – signed URL unavailable</li>`;
    }).join("")
    : "<li>No files uploaded.</li>";

  const htmlBody = `<!doctype html>
<html>
  <body>
    <p>A new lead just arrived via 2nd Opinion Construction.</p>
    <ul>${htmlLines}</ul>
    <h3>Files</h3>
    <ul>${htmlUploads}</ul>
  </body>
</html>`;

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mailFrom,
      to: [mailTo],
      subject,
      text: textBody,
      html: htmlBody,
    }),
  });

  if (!emailResponse.ok) {
    const body = await emailResponse.text();
    console.error("Resend error", emailResponse.status, body);
    return jsonResponse({ error: "Email dispatch failed", status: emailResponse.status }, 502);
  }

  console.log("Notification email sent", { lead_id: leadId, to: mailTo });
  return jsonResponse({ success: true }, 200);
});

function formatBytes(bytes: number) {
  const thresh = 1024;
  if (Math.abs(bytes) < thresh) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let u = -1;
  let value = bytes;
  do {
    value /= thresh;
    ++u;
  } while (Math.abs(value) >= thresh && u < units.length - 1);
  return `${value.toFixed(1)} ${units[u]}`;
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
