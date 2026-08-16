import { sendNotification } from "web-push-neo";

const SITE_ORIGINAL = "https://controle-cine-brasil.redecondoclub.chatgpt.site";
const TIPOS = { reservation: "Reserva do salão", moving: "Mudança ou transporte", noise: "Comunicação de barulho" };
const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

function upstreamUrl(request) {
  const incoming = new URL(request.url);
  let pathname = incoming.pathname;
  if (pathname === "/morador" || pathname === "/morador/") pathname = "/";
  if (pathname === "/admin/") pathname = "/admin";
  return new URL(pathname + incoming.search, SITE_ORIGINAL);
}

function upstreamHeaders(request, target) {
  const headers = new Headers(request.headers);
  headers.set("Host", target.host);
  if (headers.has("Origin")) headers.set("Origin", SITE_ORIGINAL);
  if (headers.has("Referer")) headers.set("Referer", headers.get("Referer").replace(new URL(request.url).origin, SITE_ORIGINAL));
  return headers;
}

async function proxy(request) {
  const incoming = new URL(request.url);
  const target = upstreamUrl(request);
  const response = await fetch(target, {
    method: request.method,
    headers: upstreamHeaders(request, target),
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });
  const headers = new Headers(response.headers);
  const redirect = headers.get("Location");
  if (redirect) {
    const redirected = new URL(redirect, SITE_ORIGINAL);
    if (redirected.origin === SITE_ORIGINAL) headers.set("Location", incoming.origin + redirected.pathname + redirected.search + redirected.hash);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function residentFromSession(request) {
  const target = new URL("/api/access/session", SITE_ORIGINAL);
  const response = await fetch(target, { headers: upstreamHeaders(request, target), cache: "no-store" });
  if (!response.ok) return null;
  return (await response.json()).resident || null;
}

async function subscribe(request, env) {
  const resident = await residentFromSession(request);
  if (!resident) return json({ error: "Acesso do morador necessário." }, 401);
  const subscription = await request.json().catch(() => null);
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return json({ error: "Inscrição inválida." }, 400);
  await env.PUSH_DB.prepare(`INSERT INTO push_subscriptions
    (endpoint, block, apartment, resident_name, p256dh, auth, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(endpoint) DO UPDATE SET block=excluded.block, apartment=excluded.apartment,
    resident_name=excluded.resident_name, p256dh=excluded.p256dh, auth=excluded.auth,
    updated_at=datetime('now')`)
    .bind(subscription.endpoint, resident.block || "A", String(resident.apartment), resident.name || "Morador", subscription.keys.p256dh, subscription.keys.auth)
    .run();
  return json({ ok: true });
}

async function unsubscribe(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.endpoint) return json({ error: "Endpoint obrigatório." }, 400);
  await env.PUSH_DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(body.endpoint).run();
  return json({ ok: true });
}

async function sendToApartment(env, block, apartment, payload) {
  const { results } = await env.PUSH_DB.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE block = ? AND apartment = ?")
    .bind(block || "A", String(apartment)).all();
  const dead = [];
  await Promise.all((results || []).map(async (row) => {
    try {
      await sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
        { vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }, TTL: 86400, urgency: "high" },
      );
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) dead.push(row.endpoint);
      else console.error("Falha ao enviar push", error);
    }
  }));
  await Promise.all(dead.map((endpoint) => env.PUSH_DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run()));
}

async function getAdminRequest(request, id) {
  const target = new URL("/api/admin/requests", SITE_ORIGINAL);
  const response = await fetch(target, { headers: upstreamHeaders(request, target), cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json();
  const requests = Array.isArray(data) ? data : data.requests || [];
  return requests.find((item) => String(item.id) === String(id)) || null;
}

async function handleAdminMutation(request, env, ctx) {
  const url = new URL(request.url);
  const body = await request.clone().json().catch(() => ({}));
  const response = await proxy(request);
  if (!response.ok) return response;
  if (url.pathname === "/api/admin/requests" && request.method === "PATCH") {
    ctx.waitUntil((async () => {
      const item = await getAdminRequest(request, body.id);
      if (!item) return;
      const approved = body.status === "confirmed";
      await sendToApartment(env, item.block || "A", item.apartment, {
        title: approved ? "Solicitação aprovada!" : "Solicitação não autorizada",
        body: `${TIPOS[item.kind] || "Solicitação"} · ${item.date || "Consulte os detalhes"}`,
        tag: `request-${item.id}-${body.status}`, url: "/morador/",
      });
    })());
  }
  if (url.pathname === "/api/admin/packages" && request.method === "POST") {
    ctx.waitUntil(sendToApartment(env, body.block || "A", body.apartment, {
      title: "Encomenda recebida",
      body: `${body.type || "Encomenda"} registrada para o Apto ${body.apartment}.`,
      tag: `package-${body.block || "A"}-${body.apartment}-${Date.now()}`, url: "/morador/",
    }));
  }
  return response;
}

const PUSH_SERVICE_WORKER = String.raw`
self.addEventListener("push", event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(self.registration.showNotification(data.title || "Controle Cine Brasil", {
    body: data.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
    tag: data.tag, renotify: true, data: { url: data.url || "/" }
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
    for (const client of clients) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        client.navigate(target); return client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});`;

const PUSH_CLIENT = String.raw`
(() => {
  if (!("serviceWorker" in navigator && "PushManager" in window && "Notification" in window)) return;
  const isResidentPage = location.pathname === "/" || location.pathname === "/morador" || location.pathname === "/morador/";
  const isAdminPage = location.pathname === "/admin" || location.pathname.startsWith("/admin/");
  let installPrompt = window.__cineInstallPrompt || null;

  function removeCaretakerLinks() {
    if (!isResidentPage) return;
    document.querySelectorAll('a[href="/admin"], a[href^="/admin?"]').forEach(link => link.remove());
  }

  function removeResidentReturnButton() {
    if (!isAdminPage) return;
    [...document.querySelectorAll("a, button")].forEach(element => {
      if (/voltar ao aplicativo/i.test(element.textContent || "")) element.remove();
    });
  }

  function isInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function hasNativeInstallButton() {
    return [...document.querySelectorAll("button, a")].some(element =>
      /baixar|instalar/i.test(element.textContent || "") && /aplicativo|app/i.test(element.textContent || "")
    );
  }

  function showResidentInstallButton() {
    if (!isResidentPage || isInstalled() || document.getElementById("cine-resident-install") || hasNativeInstallButton()) return;
    const button = document.createElement("button");
    button.id = "cine-resident-install";
    button.type = "button";
    button.innerHTML = "<span style='font-size:20px'>⬇</span><span>Baixar aplicativo<br><small style='font-weight:500'>Cine Morador</small></span>";
    button.setAttribute("aria-label", "Baixar aplicativo Cine Morador");
    Object.assign(button.style, {
      position: "fixed", right: "16px", bottom: "82px", zIndex: "99998",
      display: "flex", alignItems: "center", gap: "9px", border: "0",
      borderRadius: "14px", padding: "11px 15px", background: "#001b50",
      color: "white", boxShadow: "0 7px 24px #0005", font: "700 14px system-ui",
      lineHeight: "1.15", textAlign: "left", cursor: "pointer"
    });
    button.addEventListener("click", async () => {
      if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        button.remove();
      } else {
        toast("No menu do navegador, toque em Instalar aplicativo ou Adicionar à tela inicial.");
      }
    });
    document.body.appendChild(button);
  }

  function showAdminInstallButton() {
    if (!isAdminPage || isInstalled() || document.getElementById("cine-admin-install") || hasNativeInstallButton()) return;
    const button = document.createElement("button");
    button.id = "cine-admin-install";
    button.type = "button";
    button.innerHTML = "<span style='font-size:20px'>⬇</span><span>Baixar aplicativo<br><small style='font-weight:500'>Cine Zelador</small></span>";
    button.setAttribute("aria-label", "Baixar aplicativo Cine Zelador");
    Object.assign(button.style, {
      position: "fixed", right: "16px", bottom: "82px", zIndex: "99998",
      display: "flex", alignItems: "center", gap: "9px", border: "0",
      borderRadius: "14px", padding: "11px 15px", background: "#001b50",
      color: "white", boxShadow: "0 7px 24px #0005", font: "700 14px system-ui",
      lineHeight: "1.15", textAlign: "left", cursor: "pointer"
    });
    button.addEventListener("click", async () => {
      if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        button.remove();
      } else {
        toast("No menu do navegador, toque em Instalar aplicativo ou Adicionar à tela inicial.");
      }
    });
    document.body.appendChild(button);
  }

  window.addEventListener("beforeinstallprompt", event => {
    if (!isResidentPage && !isAdminPage) return;
    event.preventDefault();
    installPrompt = event;
    if (isAdminPage) showAdminInstallButton();
    else showResidentInstallButton();
  });

  window.addEventListener("cineinstallready", () => {
    installPrompt = window.__cineInstallPrompt || null;
    if (isAdminPage) showAdminInstallButton();
    else if (isResidentPage) showResidentInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    document.getElementById("cine-resident-install")?.remove();
    document.getElementById("cine-admin-install")?.remove();
  });
  const keyBytes = value => {
    const padded = value + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  };
  const toast = message => {
    const item = document.createElement("div"); item.textContent = message;
    Object.assign(item.style, { position:"fixed", top:"16px", left:"50%", transform:"translateX(-50%)", zIndex:"99999", background:"#001b50", color:"white", padding:"12px 18px", borderRadius:"10px", boxShadow:"0 6px 22px #0004", font:"600 14px system-ui", maxWidth:"calc(100vw - 32px)", textAlign:"center" });
    document.body.appendChild(item); setTimeout(() => item.remove(), 4000);
  };
  async function activate(showSuccess = false) {
    if (Notification.permission !== "granted") return;
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const { publicKey } = await fetch("/api/push/vapid-key", { cache:"no-store" }).then(r => r.json());
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:keyBytes(publicKey) });
      const response = await fetch("/api/push/subscribe", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(subscription) });
      if (response.ok && showSuccess) toast("Notificações ativadas neste celular.");
    } catch (error) {
      console.error("Não foi possível ativar o push", error);
      if (showSuccess) toast("Não foi possível ativar. Entre novamente e tente outra vez.");
    }
  }
  navigator.serviceWorker.register("/sw.js").then(() => activate(false));
  if (isResidentPage) {
    removeCaretakerLinks();
    const observer = new MutationObserver(() => removeCaretakerLinks());
    observer.observe(document.documentElement, { childList:true, subtree:true });
    setTimeout(showResidentInstallButton, 1800);
  }
  if (isAdminPage) {
    removeResidentReturnButton();
    const observer = new MutationObserver(() => removeResidentReturnButton());
    observer.observe(document.documentElement, { childList:true, subtree:true });
    setTimeout(showAdminInstallButton, 1800);
  }
  document.addEventListener("click", event => {
    const button = event.target.closest('button[title="Ativar notificações"]');
    if (!button) return;
    setTimeout(async () => {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") await activate(true);
      else if (Notification.permission === "denied") toast("Notificações bloqueadas nas configurações do navegador.");
    }, 100);
  }, true);
})();`;

class PushScriptInjector {
  element(element) { element.append('<script src="/push-client.js" defer></script>', { html: true }); }
}

class InstallCaptureInjector {
  element(element) {
    element.prepend(`<script>
      window.__cineInstallPrompt = null;
      window.addEventListener("beforeinstallprompt", function(event) {
        event.preventDefault();
        window.__cineInstallPrompt = event;
        window.dispatchEvent(new Event("cineinstallready"));
      });
    </script>`, { html: true });
  }
}

class AdminManifestLink {
  element(element) { element.setAttribute("href", "/admin-manifest.webmanifest"); }
}

class ResidentManifestLink {
  element(element) { element.setAttribute("href", "/resident-manifest.webmanifest"); }
}

const RESIDENT_MANIFEST = {
  id: "/morador/",
  name: "Controle Cine Brasil - Morador",
  short_name: "Cine Morador",
  description: "Reservas, comunicações e encomendas do Condomínio Cine Brasil.",
  lang: "pt-BR",
  start_url: "/morador/",
  scope: "/morador/",
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#001b50",
  theme_color: "#001b50",
  categories: ["productivity", "lifestyle"],
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

const ADMIN_MANIFEST = {
  id: "/admin/",
  name: "Controle Cine Brasil - Zelador",
  short_name: "Cine Zelador",
  description: "Painel do zelador do Condomínio Cine Brasil.",
  lang: "pt-BR",
  start_url: "/admin/",
  scope: "/admin/",
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#001b50",
  theme_color: "#001b50",
  categories: ["productivity"],
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/push/vapid-key" && request.method === "GET") return json({ publicKey: env.VAPID_PUBLIC_KEY });
    if (url.pathname === "/api/push/subscribe" && request.method === "POST") return subscribe(request, env);
    if (url.pathname === "/api/push/unsubscribe" && request.method === "POST") return unsubscribe(request, env);
    if (url.pathname === "/resident-manifest.webmanifest") return new Response(JSON.stringify(RESIDENT_MANIFEST), { headers: { "content-type":"application/manifest+json; charset=utf-8", "cache-control":"public, max-age=3600" } });
    if (url.pathname === "/admin-manifest.webmanifest") return new Response(JSON.stringify(ADMIN_MANIFEST), { headers: { "content-type":"application/manifest+json; charset=utf-8", "cache-control":"public, max-age=3600" } });
    if (url.pathname === "/push-client.js") return new Response(PUSH_CLIENT, { headers: { "content-type":"text/javascript; charset=utf-8", "cache-control":"no-cache" } });
    if (url.pathname === "/sw.js") {
      const original = await proxy(request);
      return new Response(`${await original.text()}\n${PUSH_SERVICE_WORKER}`, { headers: { "content-type":"text/javascript; charset=utf-8", "cache-control":"no-cache" } });
    }
    if ((url.pathname === "/api/admin/requests" && request.method === "PATCH") || (url.pathname === "/api/admin/packages" && request.method === "POST")) return handleAdminMutation(request, env, ctx);
    const response = await proxy(request);
    if ((response.headers.get("content-type") || "").includes("text/html")) {
      const rewriter = new HTMLRewriter()
        .on("head", new InstallCaptureInjector())
        .on("body", new PushScriptInjector());
      if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) rewriter.on('link[rel="manifest"]', new AdminManifestLink());
      else if (url.pathname === "/" || url.pathname === "/morador" || url.pathname === "/morador/") rewriter.on('link[rel="manifest"]', new ResidentManifestLink());
      return rewriter.transform(response);
    }
    return response;
  },
};
