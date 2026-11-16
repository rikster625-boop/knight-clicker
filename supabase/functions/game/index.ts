
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmac(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message),
  );
}

async function verifyTelegram(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) throw new Error("Missing Telegram hash");

  params.delete("hash");

  const entries = Array.from(params.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  const dataCheckString = entries
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = await hmac(
    new TextEncoder().encode("WebAppData").buffer,
    botToken,
  );

  const calculatedHash = toHex(
    await hmac(secretKey, dataCheckString),
  );

  if (calculatedHash.length !== receivedHash.length) {
    throw new Error("Invalid Telegram signature");
  }

  let difference = 0;
  for (let i = 0; i < calculatedHash.length; i++) {
    difference |= calculatedHash.charCodeAt(i) ^ receivedHash.charCodeAt(i);
  }

  if (difference !== 0) throw new Error("Invalid Telegram signature");

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);

  if (!authDate || authDate > now + 60 || now - authDate > 86400) {
    throw new Error("Telegram session expired");
  }

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Missing Telegram user");

  const user = JSON.parse(userRaw);

  if (!user.id || !Number.isSafeInteger(Number(user.id))) {
    throw new Error("Invalid Telegram user");
  }

  return user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: corsHeaders },
    );
  }

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!botToken || !supabaseUrl || !serviceKey) {
      throw new Error("Server configuration is incomplete");
    }

    const body = await req.json();
    const initData = body?.initData;

    if (typeof initData !== "string" || !initData) {
      return Response.json(
        { error: "Missing initData" },
        { status: 400, headers: corsHeaders },
      );
    }

    const user = await verifyTelegram(initData, botToken);

    const supabase = createClient(supabaseUrl, serviceKey);

    const { error: saveError } = await supabase
      .from("players")
      .upsert(
        {
          telegram_id: String(user.id),
          username: user.username ?? null,
          first_name: user.first_name ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "telegram_id" },
      );

    if (saveError) throw saveError;

    const { data: player, error: loadError } = await supabase
      .from("players")
      .select("telegram_id, username, first_name, coins, level, wave, total_damage, game_state")
      .eq("telegram_id", String(user.id))
      .single();

    if (loadError) throw loadError;

    return Response.json(
      { success: true, player },
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error("Game function error:", error);

    return Response.json(
      { error: "Authentication or server error" },
      { status: 401, headers: corsHeaders },
    );
  }
});
