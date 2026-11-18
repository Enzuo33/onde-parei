// Onde Parei — app (JS puro, sem framework)
"use strict";

const $tela = document.getElementById("tela");
const $abas = document.getElementById("abas");
const IMG = "https://image.tmdb.org/t/p/";
const ROTULO = { quero: "Quero ver", assistindo: "Assistindo", terminei: "Terminei", pausei: "Pausei", larguei: "Larguei" };
const ROTULO_FILME = { quero: "Quero ver", terminei: "Já vi", assistindo: "Vendo", pausei: "Pausei", larguei: "Larguei" };

// ---------- armazenamento (tolerante a modo privado) ----------
const guardar = {
  ler(k) { try { return localStorage.getItem(k); } catch { return null; } },
  por(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
let token = guardar.ler("op_token");

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const img = (p, t = "w342") => (p ? IMG + t + p : null);
const capa = (p, alt, t) => (p ? `<img src="${img(p, t)}" alt="${esc(alt)}" loading="lazy">` : `<div class="semimg">${esc(alt)}</div>`);
const carregando = () => `<div class="carregando"><i></i></div>`;
const tipoNome = (x) => (x.anime ? "Anime" : x.tipo === "movie" ? "Filme" : "Série");
const epTxt = (t, e) => `T${t} · E${e}`;

function aviso(msg) {
  const a = document.getElementById("aviso");
  a.textContent = msg;
  a.classList.add("on");
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => a.classList.remove("on"), 2200);
}

async function api(caminho, opcoes = {}) {
  const r = await fetch("/api/" + caminho, {
    method: opcoes.method || "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { sair(); throw new Error("Entre de novo"); }
  if (!r.ok) throw new Error(d.erro || "Algo deu errado");
  return d;
}

function sair() {
  token = null;
  guardar.por("op_token", null);
  location.hash = "#/entrar";
}

// ---------- rotas ----------
const rotas = { entrar: telaEntrar, inicio: telaInicio, buscar: telaBuscar, lista: telaLista, perfil: telaPerfil, u: telaPerfil, t: telaTitulo };

function rotear() {
  const partes = location.hash.replace(/^#\/?/, "").split("/");
  let nome = partes[0] || "inicio";
  if (!token && nome !== "entrar") { location.hash = "#/entrar"; return; }
  if (token && nome === "entrar") nome = "inicio";
  const tela = rotas[nome] || telaInicio;
  $abas.hidden = nome === "entrar";
  $abas.querySelectorAll("a").forEach((a) => a.classList.toggle("ativa", a.dataset.aba === nome));
  window.scrollTo(0, 0);
  tela(...partes.slice(1)).catch((e) => {
    $tela.innerHTML = `<div class="vazio">${esc(e.message)}</div>`;
  });
}
window.addEventListener("hashchange", rotear);

// ---------- entrar / criar conta ----------
async function telaEntrar() {
  let modo = "login";
  const desenhar = () => {
    $tela.innerHTML = `
      <div class="entrar">
        <img class="logo" src="/icones/icone.svg" alt="">
        <h1>Onde <em>Parei</em></h1>
        <p>Filmes, séries e animes num lugar só. Marque o episódio, dê nota, escreva a review e veja o que seus amigos estão assistindo.</p>
        <form class="form" id="f">
          ${modo === "cadastro" ? `<input name="nome" placeholder="Seu nome" autocomplete="name" maxlength="40">` : ""}
          <input name="usuario" placeholder="Usuário" autocomplete="username" autocapitalize="none" required>
          <input name="senha" type="password" placeholder="Senha" autocomplete="${modo === "login" ? "current-password" : "new-password"}" required>
          <div class="erro" id="err"></div>
          <button class="btn">${modo === "login" ? "Entrar" : "Criar conta"}</button>
        </form>
        ${modo === "login" ? `<button class="demo" id="demo">Entrar como demonstração<small>conta de exemplo já preenchida, sem cadastro</small></button>` : ""}
        <button class="troca" id="troca">${modo === "login" ? "Primeira vez? <b>Criar conta</b>" : "Já tem conta? <b>Entrar</b>"}</button>
      </div>`;
    document.getElementById("troca").onclick = () => { modo = modo === "login" ? "cadastro" : "login"; desenhar(); };
    const bd = document.getElementById("demo");
    if (bd) bd.onclick = () => entrarDemo(bd);
    document.getElementById("f").onsubmit = async (ev) => {
      ev.preventDefault();
      const dados = Object.fromEntries(new FormData(ev.target));
      const btn = ev.target.querySelector("button");
      btn.disabled = true;
      try {
        const r = await api(modo === "login" ? "login" : "cadastro", { method: "POST", body: dados });
        token = r.token;
        guardar.por("op_token", token);
        location.hash = "#/inicio";
      } catch (e) {
        document.getElementById("err").textContent = e.message;
        btn.disabled = false;
      }
    };
  };
  desenhar();
}

async function entrarDemo(botao) {
  if (botao) { botao.disabled = true; botao.firstChild.textContent = "Preparando a demonstração…"; }
  try {
    const r = await api("demo", { method: "POST" });
    token = r.token;
    guardar.por("op_token", token);
    location.hash = demoIr || "#/inicio";
  } catch (e) {
    aviso(e.message);
    if (botao) { botao.disabled = false; botao.firstChild.textContent = "Entrar como demonstração"; }
  }
}
// link com ?demo entra direto na demonstração
// ?demo&ir=/t/tv/94605 abre a demonstração já numa tela específica
const demoIr = (() => { const i = new URLSearchParams(location.search).get("ir"); return i && /^\/[\w/]+$/.test(i) ? "#" + i : null; })();
if (/[?&]demo\b/.test(location.search) && (!token || demoIr)) {
  history.replaceState(null, "", location.pathname + "#/entrar");
  setTimeout(() => entrarDemo(document.getElementById("demo")), 0);
}

// ---------- cartões ----------
function cartaoPoster(x, extra = "") {
  const tipo = x.tipo, id = x.tmdb_id || x.id;
  const meu = x.meu || (x.tmdb_id ? x : null);
  let selo = "";
  if (meu && meu.status === "assistindo" && meu.temporada) selo = `<span class="selo v">${epTxt(meu.temporada, meu.episodio)}</span>`;
  else if (meu) selo = `<span class="selo${meu.status === "assistindo" ? " v" : ""}">${(tipo === "movie" ? ROTULO_FILME : ROTULO)[meu.status]}</span>`;
  const fav = meu && meu.favorito ? `<svg class="coracao" viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>` : "";
  return `<a class="poster" href="#/t/${tipo}/${id}">
    ${capa(x.poster, x.titulo)}${selo}${fav}
    <div class="rot">${esc(x.titulo)}</div>
    <div class="sub">${esc([tipoNome(x), x.ano].filter(Boolean).join(" · "))}${extra}</div>
  </a>`;
}

function cartaoContinuar(i) {
  const pct = i.total_eps ? Math.min(100, Math.round((i.vistos_n / i.total_eps) * 100)) : 0;
  const parei = i.temporada ? `Parei em <b>${epTxt(i.temporada, i.episodio)}</b>` : "Ainda não começou";
  return `<div class="cont" data-id="${i.tmdb_id}">
    <a href="#/t/tv/${i.tmdb_id}">${capa(i.poster, i.titulo, "w185")}</a>
    <a class="info" href="#/t/tv/${i.tmdb_id}">
      <h3>${esc(i.titulo)}</h3>
      <div class="parei">${parei}${i.total_eps ? ` · ${i.vistos_n}/${i.total_eps}` : ""}</div>
      <div class="barra"><i style="width:${pct}%"></i></div>
    </a>
    <button class="btn-prox" data-prox="${i.tmdb_id}">+1<br>ep</button>
  </div>`;
}

async function marcarProximo(id, botao) {
  botao.disabled = true;
  try {
    const r = await api(`item/tv/${id}/episodio`, { method: "POST", body: { proximo: true } });
    aviso(r.meu.status === "terminei" ? "Terminou! 🎉" : `Marcado ${epTxt(r.meu.temporada, r.meu.episodio)}`);
    return r;
  } catch (e) {
    aviso(e.message);
  } finally {
    botao.disabled = false;
  }
}

// ---------- início ----------
let cacheDestaques = null;
async function telaInicio() {
  $tela.innerHTML = `<div class="topo"><div class="marca">Onde <b>Parei</b></div></div>${carregando()}`;
  const [{ itens }, { pessoas }] = await Promise.all([api("lista"), api("pessoas").catch(() => ({ pessoas: [] }))]);
  const assistindo = itens.filter((i) => i.status === "assistindo" && i.tipo === "tv");
  const filmesVendo = itens.filter((i) => i.status === "assistindo" && i.tipo === "movie");
  const quero = itens.filter((i) => i.status === "quero");
  $tela.innerHTML = `
    <div class="topo"><div class="marca">Onde <b>Parei</b></div></div>
    <div class="secao"><h2>Continuar assistindo</h2><small>${assistindo.length || ""}</small></div>
    ${assistindo.length ? `<div class="continuar moldura">${assistindo.map(cartaoContinuar).join("")}</div>`
      : `<div class="vazio">Nada em andamento. Busque uma série ou anime e marque o episódio onde parou.</div>`}
    ${pessoas.filter((u) => u.vendo.length).map((u) => `<div class="secao"><a class="secao-pessoa" href="#/u/${encodeURIComponent(u.usuario)}">${avatarMini(u)}<h2>${esc(u.nome.split(" ")[0])} está vendo</h2></a><small>${u.vendo.length}</small></div>
      <div class="trilho">${u.vendo.map((x) => cartaoPoster(x)).join("")}</div>`).join("")}
    ${filmesVendo.length ? `<div class="secao"><h2>Filmes pela metade</h2></div><div class="trilho">${filmesVendo.map((x) => cartaoPoster(x)).join("")}</div>` : ""}
    ${quero.length ? `<div class="secao"><h2>Quero ver</h2><small>${quero.length}</small></div><div class="trilho">${quero.map((x) => cartaoPoster(x)).join("")}</div>` : ""}
    <div id="dest">${carregando()}</div>`;
  $tela.querySelectorAll("[data-prox]").forEach((b) => (b.onclick = async () => {
    const r = await marcarProximo(b.dataset.prox, b);
    if (r) telaInicio();
  }));
  try {
    cacheDestaques = cacheDestaques || (await api("destaques"));
    const d = cacheDestaques;
    const bloco = (t, l) => `<div class="secao"><h2>${t}</h2></div><div class="trilho">${l.map((x) => cartaoPoster(x)).join("")}</div>`;
    document.getElementById("dest").innerHTML =
      bloco("Filmes em alta", d.filmes) + bloco("Séries em alta", d.series) + bloco("Animes populares", d.animes);
  } catch (e) {
    const el = document.getElementById("dest");
    if (el) el.innerHTML = `<div class="vazio" style="margin-top:20px">${esc(e.message)}</div>`;
  }
}

// ---------- buscar ----------
let ultimaBusca = { q: "", filtro: "tudo", res: [] };
async function telaBuscar() {
  $tela.innerHTML = `
    <div class="topo"><h1>Buscar</h1></div>
    <label class="campo"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
      <input id="q" type="search" placeholder="Filme, série ou anime" autocomplete="off" enterkeyhint="search" value="${esc(ultimaBusca.q)}"></label>
    <div class="chips" id="fil">
      ${["tudo", "filmes", "series", "animes"].map((f) => `<button class="chip${ultimaBusca.filtro === f ? " on" : ""}" data-f="${f}">${{ tudo: "Tudo", filmes: "Filmes", series: "Séries", animes: "Animes" }[f]}</button>`).join("")}
    </div>
    <div id="res" style="margin-top:14px"></div>`;
  const $q = document.getElementById("q");
  const $res = document.getElementById("res");
  const mostrar = () => {
    const f = ultimaBusca.filtro;
    const l = ultimaBusca.res.filter((x) => f === "tudo" || (f === "filmes" && x.tipo === "movie") || (f === "series" && x.tipo === "tv" && !x.anime) || (f === "animes" && x.anime));
    $res.innerHTML = !ultimaBusca.q ? `<div class="vazio">Digite o nome pra começar.</div>`
      : l.length ? `<div class="grade">${l.map((x) => cartaoPoster(x)).join("")}</div>` : `<div class="vazio">Nada encontrado.</div>`;
  };
  const buscar = async () => {
    const q = $q.value.trim();
    ultimaBusca.q = q;
    if (!q) { ultimaBusca.res = []; return mostrar(); }
    $res.innerHTML = carregando();
    try {
      const r = await api("busca?q=" + encodeURIComponent(q));
      if ($q.value.trim() !== q) return;
      ultimaBusca.res = r.resultados;
      mostrar();
    } catch (e) { $res.innerHTML = `<div class="vazio">${esc(e.message)}</div>`; }
  };
  let t;
  $q.oninput = () => { clearTimeout(t); t = setTimeout(buscar, 350); };
  $q.onkeydown = (e) => { if (e.key === "Enter") { clearTimeout(t); buscar(); $q.blur(); } };
  document.getElementById("fil").onclick = (e) => {
    const b = e.target.closest("[data-f]");
    if (!b) return;
    ultimaBusca.filtro = b.dataset.f;
    document.querySelectorAll("#fil .chip").forEach((c) => c.classList.toggle("on", c === b));
    mostrar();
  };
  mostrar();
  if (!ultimaBusca.q) $q.focus();
}

// ---------- minha lista ----------
let filtroLista = { status: "assistindo", tipo: "tudo" };
async function telaLista() {
  $tela.innerHTML = `<div class="topo"><h1>Minha lista</h1></div>${carregando()}`;
  const { itens } = await api("lista");
  const conta = (s) => itens.filter((i) => (s === "favoritos" ? i.favorito : i.status === s)).length;
  const desenhar = () => {
    const f = filtroLista;
    const l = itens.filter((i) => (f.status === "favoritos" ? i.favorito : i.status === f.status))
      .filter((i) => f.tipo === "tudo" || (f.tipo === "filmes" && i.tipo === "movie") || (f.tipo === "series" && i.tipo === "tv" && !i.anime) || (f.tipo === "animes" && i.anime));
    $tela.innerHTML = `
      <div class="topo"><h1>Minha lista</h1><small style="color:var(--suave)">${itens.length} títulos</small></div>
      <div class="chips" id="st">
        ${["assistindo", "quero", "terminei", "pausei", "larguei", "favoritos"].map((s) =>
          `<button class="chip${f.status === s ? " on" : ""}" data-s="${s}">${s === "favoritos" ? "Favoritos" : ROTULO[s]} ${conta(s) || ""}</button>`).join("")}
      </div>
      <div class="chips" id="tp" style="margin-top:8px">
        ${["tudo", "filmes", "series", "animes"].map((t) => `<button class="chip${f.tipo === t ? " on" : ""}" data-t="${t}">${{ tudo: "Tudo", filmes: "Filmes", series: "Séries", animes: "Animes" }[t]}</button>`).join("")}
      </div>
      <div style="margin-top:14px">${l.length ? `<div class="grade moldura">${l.map((x) => cartaoPoster(x, x.nota ? ` · ${x.nota}★` : "")).join("")}</div>`
        : `<div class="vazio">Nada aqui ainda.</div>`}</div>`;
    document.getElementById("st").onclick = (e) => { const b = e.target.closest("[data-s]"); if (b) { f.status = b.dataset.s; desenhar(); } };
    document.getElementById("tp").onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) { f.tipo = b.dataset.t; desenhar(); } };
  };
  desenhar();
}

// ---------- página do título ----------
const cacheTemporadas = {};
async function telaTitulo(tipo, id) {
  $tela.innerHTML = carregando();
  let t = await api(`titulo/${tipo}/${id}`);
  let vistos = new Set(t.vistos.map((v) => v.temporada + ":" + v.episodio));
  let meu = t.meu;
  const aberta = new Set();
  const R = tipo === "movie" ? ROTULO_FILME : ROTULO;

  const salvar = async (corpo, msg) => {
    try {
      meu = await api(`item/${tipo}/${id}`, { method: "PUT", body: corpo });
      if (msg) aviso(msg);
      desenhar();
    } catch (e) { aviso(e.message); }
  };

  const estrelas = (nota) => [1, 2, 3, 4, 5].map((n) => {
    const cheia = nota >= n, meia = !cheia && nota >= n - 0.5;
    return `<button data-n="${n}" aria-label="${n} estrelas"><svg viewBox="0 0 24 24">
      <defs><clipPath id="m${n}"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>
      <path class="v" d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/>
      ${cheia ? `<path class="f" d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/>` : ""}
      ${meia ? `<path class="f" clip-path="url(#m${n})" d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/>` : ""}
    </svg></button>`;
  }).join("");

  const proximoTxt = () => {
    if (!meu || !meu.temporada) return null;
    const s = t.temporadas.find((x) => x.numero === meu.temporada);
    if (s && meu.episodio < s.episodios) return epTxt(meu.temporada, meu.episodio + 1);
    const ns = t.temporadas.find((x) => x.numero === meu.temporada + 1);
    return ns ? epTxt(ns.numero, 1) : null;
  };

  const blocoTemporada = (s) => {
    const vistosS = [...vistos].filter((k) => k.startsWith(s.numero + ":")).length;
    const ab = aberta.has(s.numero);
    const eps = cacheTemporadas[id + ":" + s.numero];
    return `<div class="temp moldura${ab ? " aberta" : ""}" data-temp="${s.numero}">
      <button data-abre="${s.numero}"><span class="n">${esc(s.nome)}</span>
        <span class="c${vistosS === s.episodios ? " ok" : ""}">${vistosS}/${s.episodios}</span>
        <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>
      ${ab ? `<div class="eps">${eps ? eps.episodios.map((e) => {
        const v = vistos.has(s.numero + ":" + e.numero);
        const atual = meu && meu.temporada === s.numero && meu.episodio === e.numero;
        return `<div class="ep${atual ? " atual" : ""}">
          <span class="num">${e.numero}</span>
          <div class="nm"><div>${esc(e.nome || "Episódio " + e.numero)}</div><small>${[e.data ? e.data.split("-").reverse().join("/") : "", e.minutos ? e.minutos + " min" : "", atual ? "parei aqui" : ""].filter(Boolean).join(" · ")}</small></div>
          ${!v ? `<button class="ate" data-ate="${s.numero}:${e.numero}">até aqui</button>` : ""}
          <button class="check${v ? " on" : ""}" data-ep="${s.numero}:${e.numero}:${e.minutos || ""}" aria-label="Marcar episódio ${e.numero}"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button>
        </div>`;
      }).join("") : carregando()}</div>` : ""}
    </div>`;
  };

  const desenhar = () => {
    const nota = meu?.nota || 0;
    const onde = t.onde;
    const temOnde = onde.assinatura.length || onde.gratis.length || onde.alugar.length || onde.comprar.length;
    const prox = proximoTxt();
    const statusList = tipo === "movie" ? ["quero", "terminei"] : ["quero", "assistindo", "terminei", "pausei", "larguei"];
    $tela.innerHTML = `
      <button class="voltar" onclick="history.length > 1 ? history.back() : location.hash='#/inicio'"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>Voltar</button>
      ${t.fundo ? `<div class="capa"><img src="${img(t.fundo, "w780")}" alt=""></div>` : `<div style="height:96px"></div>`}
      <div class="cab">
        ${t.poster ? `<img class="pp" src="${img(t.poster)}" alt="">` : `<div class="pp semimg">${esc(t.titulo)}</div>`}
        <div>
          <h1>${esc(t.titulo)}</h1>
          <div class="meta">${esc([tipoNome(t), t.ano, t.duracao ? t.duracao + " min" : "", t.temporadas.length ? t.temporadas.length + (t.temporadas.length > 1 ? " temporadas" : " temporada") : ""].filter(Boolean).join(" · "))}</div>
          <div class="meta">${esc(t.generos.slice(0, 3).join(", "))}${t.nota_tmdb ? ` · TMDB ${t.nota_tmdb}` : ""}</div>
        </div>
      </div>
      ${t.sinopse ? `<p class="sinopse curta" id="sin">${esc(t.sinopse)}</p><button class="mais" id="mais">ler mais</button>` : ""}

      <div class="status">
        ${statusList.map((s) => `<button data-st="${s}" class="${meu?.status === s ? "on" : ""}">${R[s]}</button>`).join("")}
        <button class="fav${meu?.favorito ? " on" : ""}" data-fav><svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>Favorito</button>
      </div>

      ${tipo === "tv" ? `<div class="parei-box moldura">
        <div class="tx"><small>Onde parei</small><b>${meu?.temporada ? epTxt(meu.temporada, meu.episodio) : "Não comecei"}</b>
        ${prox ? `<small>Próximo: ${prox}</small>` : ""}</div>
        ${prox || !meu?.temporada ? `<button class="btn" id="prox">${meu?.temporada ? "Vi o próximo" : "Vi o 1º ep"}</button>` : ""}
      </div>` : ""}

      <div class="secao"><h2>Minha nota</h2>${nota ? `<small>${String(nota).replace(".", ",")} de 5</small>` : ""}</div>
      <div class="linha"><div class="estrelas" id="est">${estrelas(nota)}</div>${nota ? `<button class="mais" id="tiranota">limpar</button>` : ""}</div>

      <div class="review moldura" style="margin-top:14px">
        <div class="linha"><h2 style="font-size:16px">Minha review</h2>${meu?.review_em && meu.review ? `<small style="color:var(--suave)">${new Date(meu.review_em).toLocaleDateString("pt-BR")}</small>` : ""}</div>
        <textarea id="rev" placeholder="O que achou? Sem spoiler... ou com, a review é sua.">${esc(meu?.review || "")}</textarea>
        <div class="linha" style="margin-top:10px"><span></span><button class="btn" id="salvarRev">Salvar review</button></div>
      </div>

      ${t.outros.length ? `<div class="secao"><h2>${t.outros.some((o) => o.review) ? "Reviews" : "Quem mais viu"}</h2><small>${t.outros.length}</small></div>
        <div class="moldura">${t.outros.map((o) => `<div class="rev-outro">
          <a class="rev-quem" href="#/u/${encodeURIComponent(o.usuario)}">${avatarMini(o)}
            <div><b>${esc(o.nome)}</b><small>${esc(progressoTxt({ ...o, tipo }))}${o.favorito ? " · ♥ favorito" : ""}</small></div>
            ${o.nota ? `<span class="mini-est">${estrelinhas(o.nota)}</span>` : ""}</a>
          ${o.review ? `<p>${esc(o.review)}</p><small class="quando">${dataBR(o.review_em)}</small>` : ""}
        </div>`).join("")}</div>` : ""}

      ${temOnde ? `<div class="secao"><h2>Onde assistir</h2><small>no Brasil</small></div>
        ${[["assinatura", "Assinatura"], ["gratis", "Grátis"], ["alugar", "Alugar"], ["comprar", "Comprar"]].filter(([k]) => onde[k].length)
          .map(([k, n]) => `<div class="onde-rot">${n}</div><div class="onde">${onde[k].map((p) => `<img src="${img(p.logo, "w92")}" alt="${esc(p.nome)}" title="${esc(p.nome)}">`).join("")}</div>`).join("")}
        <div class="onde-rot" style="margin-top:8px">Dados de disponibilidade: JustWatch</div>` : ""}

      ${tipo === "tv" && t.temporadas.length ? `<div class="secao"><h2>Episódios</h2><small>${vistos.size}${t.total_eps ? "/" + t.total_eps : ""} vistos</small></div>
        <div id="temps">${t.temporadas.map(blocoTemporada).join("")}</div>` : ""}

      ${t.elenco.length ? `<div class="secao"><h2>Elenco</h2></div><div class="elenco">${t.elenco.map((c) => `<div class="ator">${c.foto ? `<img src="${img(c.foto, "w185")}" alt="" loading="lazy">` : `<div class="semimg"></div>`}${esc(c.nome)}<small>${esc(c.personagem || "")}</small></div>`).join("")}</div>` : ""}

      ${meu ? `<div style="text-align:center;margin-top:28px"><button class="mais" id="tirar" style="color:var(--suave)">Tirar da minha lista</button></div>` : ""}
    `;
    ligar();
  };

  const recarregarTemporada = async (n) => {
    const k = id + ":" + n;
    if (!cacheTemporadas[k]) {
      cacheTemporadas[k] = await api(`temporada/${id}/${n}`);
    }
    desenhar();
  };

  const marcar = async (corpo) => {
    try {
      const r = await api(`item/tv/${id}/episodio`, { method: "POST", body: corpo });
      meu = r.meu;
      vistos = new Set(r.vistos.map((v) => v.temporada + ":" + v.episodio));
      if (meu.status === "terminei") aviso("Terminou! 🎉");
      desenhar();
    } catch (e) { aviso(e.message); }
  };

  function ligar() {
    const $ = (s) => $tela.querySelector(s);
    if ($("#mais")) $("#mais").onclick = (e) => { $("#sin").classList.toggle("curta"); e.target.textContent = $("#sin").classList.contains("curta") ? "ler mais" : "ler menos"; };
    $tela.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => salvar({ status: b.dataset.st }, R[b.dataset.st])));
    $("[data-fav]").onclick = () => salvar({ favorito: !meu?.favorito }, meu?.favorito ? "Tirado dos favoritos" : "Favoritado ♥");
    $("#est").onclick = (e) => {
      const b = e.target.closest("[data-n]");
      if (!b) return;
      const n = Number(b.dataset.n);
      const r = b.getBoundingClientRect();
      const meia = e.clientX - r.left < r.width / 2;
      salvar({ nota: meia ? n - 0.5 : n });
    };
    if ($("#tiranota")) $("#tiranota").onclick = () => salvar({ nota: null });
    $("#salvarRev").onclick = () => salvar({ review: $("#rev").value }, "Review salva");
    if ($("#prox")) $("#prox").onclick = (e) => { e.target.disabled = true; marcar({ proximo: true }).then(async () => {
      if (meu?.temporada && !aberta.has(meu.temporada)) { aberta.add(meu.temporada); await recarregarTemporada(meu.temporada); }
    }); };
    if ($("#tirar")) $("#tirar").onclick = async () => {
      if (!confirm("Tirar da lista? Os episódios marcados e a review serão apagados.")) return;
      await api(`item/${tipo}/${id}`, { method: "DELETE" });
      meu = null; vistos = new Set(); aviso("Tirado da lista"); desenhar();
    };
    const temps = $("#temps");
    if (temps) temps.onclick = (e) => {
      const ab = e.target.closest("[data-abre]");
      if (ab) {
        const n = Number(ab.dataset.abre);
        if (aberta.has(n)) { aberta.delete(n); desenhar(); } else { aberta.add(n); desenhar(); recarregarTemporada(n); }
        return;
      }
      const ep = e.target.closest("[data-ep]");
      if (ep) {
        const [T, E, min] = ep.dataset.ep.split(":");
        ep.classList.toggle("on");
        return marcar({ temporada: +T, episodio: +E, minutos: +min || null, visto: !vistos.has(T + ":" + E) });
      }
      const ate = e.target.closest("[data-ate]");
      if (ate) {
        const [T, E] = ate.dataset.ate.split(":");
        return marcar({ temporada: +T, episodio: +E, ateAqui: true });
      }
    };
  }

  // abre a temporada onde ela parou (ou a 1ª)
  if (tipo === "tv" && t.temporadas.length) {
    const n = meu?.temporada || t.temporadas[0].numero;
    aberta.add(n);
    desenhar();
    recarregarTemporada(n).catch(() => {});
  } else desenhar();
}

// ---------- pessoas (você e ela) ----------
const inicial = (u) => esc(((u.nome || u.usuario || "?").trim()[0] || "?").toUpperCase());
const avatarMini = (u, cls = "mini") => `<span class="av-${cls}">${u.foto ? `<img src="${u.foto}" alt="">` : inicial(u)}</span>`;
const estrelinhas = (n) => (n ? "★".repeat(Math.floor(n)) + (n % 1 ? "½" : "") : "");
const dataBR = (d) => (d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : "");
function progressoTxt(x) {
  if (x.status === "assistindo" && x.temporada) return `parou em ${epTxt(x.temporada, x.episodio)}`;
  return (x.tipo === "movie" ? ROTULO_FILME : ROTULO)[x.status]?.toLowerCase() || "";
}

// ---------- perfil (o meu ou o dela) ----------
async function telaPerfil(usuario) {
  $tela.innerHTML = carregando();
  const [p, pessoas] = await Promise.all([
    api(usuario ? "u/" + encodeURIComponent(usuario) : "perfil"),
    usuario ? Promise.resolve(null) : api("pessoas").catch(() => ({ pessoas: [] })),
  ]);
  if (p.eu && usuario) { location.hash = "#/perfil"; return; }
  const eu = p.eu;
  const itens = p.itens;
  const favs = itens.filter((i) => i.favorito);
  const vendo = itens.filter((i) => i.status === "assistindo");
  const revs = itens.filter((i) => i.review || i.nota).sort((a, b) => (b.review_em || b.atualizado_em || "").localeCompare(a.review_em || a.atualizado_em || ""));
  const s = p.stats;
  const primeiro = (p.nome || p.usuario).split(" ")[0];
  const desenhar = (editando) => {
    $tela.innerHTML = `
      ${eu ? `<div class="topo"><h1>Perfil</h1><button class="mais" id="sair" style="color:var(--suave)">Sair</button></div>`
        : `<button class="voltar" onclick="history.length > 1 ? history.back() : location.hash='#/inicio'"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>Voltar</button>`}
      ${editando ? `<form class="form" id="fp">
          <input name="nome" value="${esc(p.nome)}" placeholder="Nome" maxlength="40">
          <textarea name="bio" rows="3" placeholder="Bio" maxlength="300">${esc(p.bio || "")}</textarea>
          <div class="linha"><button type="button" class="btn sec" id="cancela">Cancelar</button><button class="btn">Salvar</button></div>
          ${p.foto ? `<button type="button" class="mais" id="tirafoto" style="color:var(--suave);align-self:flex-start">Remover foto de perfil</button>` : ""}
        </form>`
      : `<div class="perfil-cab"><${eu ? `label class="avatar trocar" title="Trocar foto"` : `div class="avatar"`}>
            ${p.foto ? `<img src="${p.foto}" alt="Foto de perfil">` : inicial(p)}
            ${eu ? `<span class="camera"><svg viewBox="0 0 24 24"><path d="M4 8.5h3l1.6-2.2h6.8L17 8.5h3v10H4z"/><circle cx="12" cy="13.2" r="3.2"/></svg></span>
            <input type="file" accept="image/*" id="foto" hidden></label>` : `</div>`}
          <div><h1>${esc(p.nome)}</h1><small>@${esc(p.usuario)}</small></div></div>
        ${p.bio ? `<div class="bio">${esc(p.bio)}</div>` : ""}
        ${eu ? `<button class="mais" id="editar" style="margin-top:6px">Editar perfil</button>` : ""}`}
      <div class="stats moldura">
        <div><b>${s.filmes}</b><small>filmes</small></div>
        <div><b>${s.series}</b><small>séries</small></div>
        <div><b>${s.animes}</b><small>animes</small></div>
        <div><b>${s.episodios}</b><small>episódios</small></div>
        <div><b>${s.horas}</b><small>horas de ep.</small></div>
        <div><b>${s.reviews}</b><small>reviews</small></div>
      </div>
      ${eu && pessoas?.pessoas?.length ? `<div class="secao"><h2>Quem mais está aqui</h2></div>
        <div class="moldura">${pessoas.pessoas.map((u) => `<a class="pessoa" href="#/u/${encodeURIComponent(u.usuario)}">${avatarMini(u)}
          <div><b>${esc(u.nome)}</b><small>${u.vendo.length ? `vendo ${esc(u.vendo[0].titulo)}${u.vendo.length > 1 ? ` e mais ${u.vendo.length - 1}` : ""}` : "@" + esc(u.usuario)}</small></div>
          <svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></a>`).join("")}</div>` : ""}
      ${!eu ? `<div class="secao"><h2>${esc(primeiro)} está vendo</h2><small>${vendo.length || ""}</small></div>
        ${vendo.length ? `<div class="trilho">${vendo.map((x) => cartaoPoster(x)).join("")}</div>` : `<div class="vazio">Nada em andamento agora.</div>`}` : ""}
      <div class="secao"><h2>Favoritos</h2><small>${favs.length || ""}</small></div>
      ${favs.length ? `<div class="trilho">${favs.map((x) => cartaoPoster(x)).join("")}</div>`
        : `<div class="vazio">${eu ? "Toque no coração de um título pra ele aparecer aqui." : "Nenhum favorito ainda."}</div>`}
      <div class="secao"><h2>${eu ? "Minhas reviews" : "Reviews de " + esc(primeiro)}</h2><small>${revs.length || ""}</small></div>
      ${revs.length ? `<div class="moldura">${revs.map((r) => `<a class="rev-item" href="#/t/${r.tipo}/${r.tmdb_id}">
          ${capa(r.poster, r.titulo, "w92")}
          <div><h3>${esc(r.titulo)}</h3><div class="mini-est">${estrelinhas(r.nota)}</div>${r.review ? `<p>${esc(r.review)}</p>` : ""}</div></a>`).join("")}</div>`
        : `<div class="vazio">${eu ? "Suas reviews vão aparecer aqui." : "Nenhuma review ainda."}</div>`}
      <div class="creditos">Dados e imagens fornecidos pela TMDB. Este app usa a API da TMDB, mas não é endossado nem certificado por ela.</div>`;
    if (!eu) return;
    document.getElementById("sair").onclick = () => { if (confirm("Sair da conta?")) sair(); };
    if (editando) {
      document.getElementById("cancela").onclick = () => desenhar(false);
      const tira = document.getElementById("tirafoto");
      if (tira) tira.onclick = async () => {
        await api("perfil/foto", { method: "PUT", body: { foto: null } });
        p.foto = null; aviso("Foto removida"); desenhar(false);
      };
      document.getElementById("fp").onsubmit = async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        await api("perfil", { method: "PUT", body: d });
        p.nome = d.nome || p.nome; p.bio = d.bio;
        aviso("Perfil salvo");
        desenhar(false);
      };
    } else {
      document.getElementById("editar").onclick = () => desenhar(true);
      document.getElementById("foto").onchange = async (e) => {
        const arq = e.target.files[0];
        if (!arq) return;
        aviso("Enviando foto…");
        try {
          const foto = await reduzirFoto(arq);
          await api("perfil/foto", { method: "PUT", body: { foto } });
          p.foto = foto; aviso("Foto salva ♥"); desenhar(false);
        } catch (err) { aviso(err.message || "Não deu pra usar essa foto"); }
      };
    }
  };
  desenhar(false);
}

// recorta no centro em quadrado e reduz pra 320px (fica leve pra salvar no banco)
async function reduzirFoto(arq) {
  if (!arq.type.startsWith("image/")) throw new Error("Escolha uma imagem");
  const bmp = await createImageBitmap(arq).catch(async () => {
    const im = new Image();
    im.src = URL.createObjectURL(arq);
    await im.decode();
    return im;
  });
  const lado = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas");
  c.width = c.height = 320;
  c.getContext("2d").drawImage(bmp, (bmp.width - lado) / 2, (bmp.height - lado) / 2, lado, lado, 0, 0, 320, 320);
  for (const q of [0.86, 0.75, 0.6]) {
    const url = c.toDataURL("image/jpeg", q);
    if (url.length < 270000) return url;
  }
  throw new Error("Foto grande demais");
}

// ---------- carrosséis no PC: arrastar com o mouse + setas ----------
function ativarArraste(el) {
  if (el.dataset.arraste) return;
  el.dataset.arraste = "1";
  let ini = null, moveu = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    ini = { x: e.clientX, s: el.scrollLeft };
    moveu = false;
  });
  window.addEventListener("pointermove", (e) => {
    if (!ini) return;
    const dx = e.clientX - ini.x;
    if (Math.abs(dx) > 5 && !moveu) { moveu = true; el.classList.add("arrastando"); }
    if (moveu) el.scrollLeft = ini.s - dx;
  });
  window.addEventListener("pointerup", () => {
    if (!ini) return;
    ini = null;
    el.classList.remove("arrastando");
  });
  // se arrastou, o soltar não conta como clique no pôster
  el.addEventListener("click", (e) => { if (moveu) { e.preventDefault(); e.stopPropagation(); moveu = false; } }, true);
  el.addEventListener("dragstart", (e) => e.preventDefault());
}

function ativarSetas(trilho) {
  if (trilho.parentElement.classList.contains("trilho-caixa")) return;
  const caixa = document.createElement("div");
  caixa.className = "trilho-caixa";
  trilho.before(caixa);
  caixa.append(trilho);
  const seta = (lado) => {
    const b = document.createElement("button");
    b.className = "seta " + lado;
    b.setAttribute("aria-label", lado === "esq" ? "Anterior" : "Próximo");
    b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${lado === "esq" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"}"/></svg>`;
    b.onclick = () => trilho.scrollBy({ left: (lado === "esq" ? -1 : 1) * trilho.clientWidth * 0.9, behavior: "smooth" });
    caixa.append(b);
    return b;
  };
  const esq = seta("esq"), dir = seta("dir");
  const atualizar = () => {
    esq.hidden = trilho.scrollLeft < 24;
    dir.hidden = trilho.scrollLeft + trilho.clientWidth >= trilho.scrollWidth - 24;
  };
  trilho.addEventListener("scroll", atualizar, { passive: true });
  requestAnimationFrame(atualizar);
}

new MutationObserver(() => {
  $tela.querySelectorAll(".trilho").forEach((t) => { ativarArraste(t); ativarSetas(t); });
  $tela.querySelectorAll(".chips, .elenco").forEach(ativarArraste);
}).observe($tela, { childList: true, subtree: true });

// ---------- PWA ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

rotear();
