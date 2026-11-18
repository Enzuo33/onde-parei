// Onde Parei — API (Cloudflare Workers + D1). Dados de filmes/séries/animes vêm da TMDB (segredo TMDB_TOKEN).
// Rotas em /api/*; o resto é o app em /public.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, nome TEXT NOT NULL,
     senha_hash TEXT NOT NULL, sal TEXT NOT NULL, bio TEXT, criado_em TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS itens (id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
     tipo TEXT NOT NULL CHECK (tipo IN ('movie','tv')), tmdb_id INTEGER NOT NULL, titulo TEXT NOT NULL, poster TEXT, ano TEXT,
     anime INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'quero', favorito INTEGER NOT NULL DEFAULT 0,
     nota REAL, review TEXT, review_em TEXT, temporada INTEGER, episodio INTEGER, total_eps INTEGER,
     criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, UNIQUE (usuario_id, tipo, tmdb_id))`,
  `CREATE INDEX IF NOT EXISTS idx_itens_user ON itens(usuario_id, atualizado_em)`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS vistos (item_id INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
     temporada INTEGER NOT NULL, episodio INTEGER NOT NULL, minutos INTEGER, visto_em TEXT NOT NULL,
     PRIMARY KEY (item_id, temporada, episodio))`,
];

const STATUS = ["quero", "assistindo", "terminei", "pausei", "larguei"];
const TMDB = "https://api.themoviedb.org/3";

// ---------- utilidades ----------
const json = (dados, status = 200, extra = {}) =>
  new Response(JSON.stringify(dados), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });
const erro = (msg, status = 400) => json({ erro: msg }, status);
const agora = () => new Date().toISOString();
const texto = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64url = (s) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hashSenha(senha, sal) {
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(sal), iterations: 100000 }, chave, 256);
  return hex(bits);
}
async function assinar(env, dados) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SEGREDO || "onde-parei-dev"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(dados)));
}
async function criarToken(env, u) {
  // "c" = data de criação da conta: se a conta for apagada e o id reaproveitado, o token antigo não vale pra conta nova
  const corpo = b64url(JSON.stringify({ id: u.id, c: u.criado_em, exp: Date.now() + 365 * 864e5 }));
  return corpo + "." + (await assinar(env, corpo));
}
async function lerToken(env, req) {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const [corpo, ass] = t.split(".");
  if (!corpo || !ass || ass !== (await assinar(env, corpo))) return null;
  let d;
  try { d = JSON.parse(atob(corpo.replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
  if (!(d.exp > Date.now())) return null;
  const u = await env.DB.prepare("SELECT id, criado_em FROM usuarios WHERE id = ?").bind(d.id).first();
  if (!u || (d.c && d.c !== u.criado_em)) return null;
  return u.id;
}

let schemaOk = false;
async function garantirSchema(env) {
  if (schemaOk) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  // colunas novas em bancos antigos (dá erro se já existe, e tudo bem)
  try { await env.DB.prepare("ALTER TABLE usuarios ADD COLUMN foto TEXT").run(); } catch {}
  schemaOk = true;
}

// ---------- TMDB ----------
async function tmdb(env, caminho, params = {}) {
  if (!env.TMDB_TOKEN) throw new Error("Falta configurar a chave da TMDB");
  const url = new URL(TMDB + caminho);
  url.searchParams.set("language", "pt-BR");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const auth = env.TMDB_TOKEN.length > 40 ? { authorization: "Bearer " + env.TMDB_TOKEN } : {};
  if (!auth.authorization) url.searchParams.set("api_key", env.TMDB_TOKEN);
  const r = await fetch(url, { headers: auth });
  if (!r.ok) throw new Error(r.status === 401 ? "Chave da TMDB inválida" : "TMDB respondeu " + r.status);
  return r.json();
}
// Anime = animação + origem japonesa (é como a TMDB organiza)
const ehAnime = (t) =>
  (t.genre_ids || (t.genres || []).map((g) => g.id)).includes(16) &&
  (t.original_language === "ja" || (t.origin_country || []).includes("JP"));
const resumo = (t, tipo) => ({
  tipo: tipo || t.media_type,
  id: t.id,
  titulo: t.title || t.name,
  original: t.original_title || t.original_name,
  ano: (t.release_date || t.first_air_date || "").slice(0, 4),
  poster: t.poster_path,
  fundo: t.backdrop_path,
  sinopse: t.overview,
  nota_tmdb: t.vote_average ? Math.round(t.vote_average * 10) / 10 : null,
  anime: ehAnime(t),
});

// ---------- rotas ----------
async function api(req, env, url) {
  const p = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const m = req.method;
  const corpo = async () => { try { return await req.json(); } catch { return {}; } };
  await garantirSchema(env);

  if (p[0] === "cadastro" && m === "POST") {
    const b = await corpo();
    const usuario = String(b.usuario || "").trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,20}$/.test(usuario)) return erro("Usuário: 3 a 20 letras, números, ponto ou _");
    if (String(b.senha || "").length < 6) return erro("A senha precisa de pelo menos 6 caracteres");
    if (await env.DB.prepare("SELECT 1 FROM usuarios WHERE usuario = ?").bind(usuario).first()) return erro("Esse usuário já existe");
    const sal = crypto.randomUUID();
    const criado = agora();
    const r = await env.DB.prepare("INSERT INTO usuarios (usuario, nome, senha_hash, sal, criado_em) VALUES (?, ?, ?, ?, ?)")
      .bind(usuario, texto(b.nome, 40) || usuario, await hashSenha(String(b.senha), sal), sal, criado).run();
    const u = { id: r.meta.last_row_id, criado_em: criado };
    return json({ token: await criarToken(env, u) });
  }
  // modo demonstração (portfólio): entra numa conta de exemplo; os dados de exemplo são refeitos a cada 15 min de uso
  if (p[0] === "demo" && m === "POST") {
    const u = await prepararDemo(env);
    return json({ token: await criarToken(env, u) });
  }
  if (p[0] === "login" && m === "POST") {
    const b = await corpo();
    const u = await env.DB.prepare("SELECT * FROM usuarios WHERE usuario = ?").bind(String(b.usuario || "").trim().toLowerCase()).first();
    if (!u || u.senha_hash !== (await hashSenha(String(b.senha || ""), u.sal))) return erro("Usuário ou senha incorretos", 401);
    return json({ token: await criarToken(env, u) });
  }

  const uid = await lerToken(env, req);
  if (!uid) return erro("Entre de novo", 401);
  const DB = env.DB;

  // busca e descoberta
  if (p[0] === "busca" && m === "GET") {
    const q = texto(url.searchParams.get("q"), 100);
    if (!q) return json({ resultados: [] });
    const d = await tmdb(env, "/search/multi", { query: q, include_adult: "false", page: url.searchParams.get("pagina") || "1" });
    const meus = await mapaMeus(DB, uid);
    return json({
      resultados: d.results.filter((t) => t.media_type === "movie" || t.media_type === "tv")
        .map((t) => ({ ...resumo(t), meu: meus[t.media_type + ":" + t.id] || null })),
      paginas: d.total_pages,
    });
  }
  if (p[0] === "destaques" && m === "GET") {
    const [filmes, series, animes] = await Promise.all([
      tmdb(env, "/trending/movie/week"),
      tmdb(env, "/trending/tv/week"),
      tmdb(env, "/discover/tv", { with_genres: "16", with_original_language: "ja", sort_by: "popularity.desc", "first_air_date.gte": "2020-01-01" }),
    ]);
    return json({
      filmes: filmes.results.slice(0, 15).map((t) => resumo(t, "movie")),
      series: series.results.slice(0, 15).map((t) => resumo(t, "tv")),
      animes: animes.results.slice(0, 15).map((t) => resumo(t, "tv")),
    });
  }

  // detalhes de um título
  if (p[0] === "titulo" && ["movie", "tv"].includes(p[1]) && p[2] && m === "GET") {
    const [tipo, id] = [p[1], Number(p[2])];
    const t = await tmdb(env, `/${tipo}/${id}`, { append_to_response: "watch/providers,credits" });
    const item = await DB.prepare("SELECT * FROM itens WHERE usuario_id = ? AND tipo = ? AND tmdb_id = ?").bind(uid, tipo, id).first();
    const vistos = item
      ? (await DB.prepare("SELECT temporada, episodio FROM vistos WHERE item_id = ?").bind(item.id).all()).results
      : [];
    // o que as outras pessoas do app acharam / onde pararam nesse título
    const outros = (await DB.prepare(`SELECT u.usuario, u.nome, u.foto, i.status, i.nota, i.review, i.review_em, i.temporada, i.episodio, i.favorito
      FROM itens i JOIN usuarios u ON u.id = i.usuario_id WHERE i.tipo = ? AND i.tmdb_id = ? AND i.usuario_id != ?
      ORDER BY i.review_em DESC, i.atualizado_em DESC`).bind(tipo, id, uid).all()).results;
    const br = t["watch/providers"]?.results?.BR || {};
    const prov = (l) => (l || []).filter((x) => !/with Ads|Amazon Channel|Standard|Basic/i.test(x.provider_name))
      .map((x) => ({ nome: x.provider_name, logo: x.logo_path }));
    return json({
      ...resumo(t, tipo),
      generos: (t.genres || []).map((g) => g.name),
      duracao: t.runtime || (t.episode_run_time || [])[0] || null,
      elenco: (t.credits?.cast || []).slice(0, 10).map((c) => ({ nome: c.name, personagem: c.character, foto: c.profile_path })),
      temporadas: (t.seasons || []).filter((s) => s.season_number > 0 && s.episode_count > 0)
        .map((s) => ({ numero: s.season_number, nome: s.name, episodios: s.episode_count, poster: s.poster_path, ano: (s.air_date || "").slice(0, 4) })),
      total_eps: t.number_of_episodes || null,
      situacao: t.status,
      onde: { assinatura: prov(br.flatrate), alugar: prov(br.rent), comprar: prov(br.buy), gratis: prov(br.free || br.ads), link: br.link || null },
      meu: item,
      vistos,
      outros,
    });
  }
  if (p[0] === "temporada" && p[1] && p[2] && m === "GET") {
    const s = await tmdb(env, `/tv/${Number(p[1])}/season/${Number(p[2])}`);
    return json({
      numero: s.season_number,
      nome: s.name,
      episodios: (s.episodes || []).map((e) => ({
        numero: e.episode_number, nome: e.name, sinopse: e.overview, data: e.air_date, minutos: e.runtime, imagem: e.still_path,
      })),
    });
  }

  // minha lista
  if (p[0] === "lista" && m === "GET") {
    const r = await DB.prepare(`SELECT i.*, (SELECT COUNT(*) FROM vistos v WHERE v.item_id = i.id) AS vistos_n
      FROM itens i WHERE i.usuario_id = ? ORDER BY i.atualizado_em DESC`).bind(uid).all();
    return json({ itens: r.results });
  }

  // salvar / atualizar item (status, favorito, nota, review)
  if (p[0] === "item" && ["movie", "tv"].includes(p[1]) && p[2] && !p[3]) {
    const [tipo, id] = [p[1], Number(p[2])];
    if (m === "DELETE") {
      await DB.prepare("DELETE FROM itens WHERE usuario_id = ? AND tipo = ? AND tmdb_id = ?").bind(uid, tipo, id).run();
      return json({ ok: true });
    }
    if (m === "PUT") {
      const b = await corpo();
      const item = await garantirItem(env, uid, tipo, id);
      const sets = [], vals = [];
      if (b.status !== undefined) { if (!STATUS.includes(b.status)) return erro("Status inválido"); sets.push("status = ?"); vals.push(b.status); }
      if (b.favorito !== undefined) { sets.push("favorito = ?"); vals.push(b.favorito ? 1 : 0); }
      if (b.nota !== undefined) {
        const n = b.nota === null ? null : Math.round(Number(b.nota) * 2) / 2;
        if (n !== null && !(n >= 0.5 && n <= 5)) return erro("Nota de 0,5 a 5");
        sets.push("nota = ?"); vals.push(n);
      }
      if (b.review !== undefined) { sets.push("review = ?", "review_em = ?"); vals.push(texto(b.review, 5000), agora()); }
      if (b.status === "terminei" && tipo === "movie") { sets.push("temporada = NULL, episodio = NULL"); }
      if (sets.length) {
        sets.push("atualizado_em = ?"); vals.push(agora());
        await DB.prepare(`UPDATE itens SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, item.id).run();
      }
      return json(await DB.prepare("SELECT * FROM itens WHERE id = ?").bind(item.id).first());
    }
  }

  // marcar episódio(s): { temporada, episodio, visto, ateAqui, minutos }
  if (p[0] === "item" && p[1] === "tv" && p[2] && p[3] === "episodio" && m === "POST") {
    const id = Number(p[2]);
    const b = await corpo();
    const item = await garantirItem(env, uid, "tv", id);
    let T = Number(b.temporada), E = Number(b.episodio), minutos = Number(b.minutos) || null;
    if (b.proximo) {
      // próximo episódio depois de onde parou (pula pra próxima temporada se acabou)
      const t = await tmdb(env, `/tv/${id}`);
      const temps = (t.seasons || []).filter((s) => s.season_number > 0 && s.episode_count > 0).sort((a, b) => a.season_number - b.season_number);
      if (!temps.length) return erro("Essa série não tem episódios listados");
      if (!item.temporada) { T = temps[0].season_number; E = 1; }
      else {
        const atual = temps.find((s) => s.season_number === item.temporada);
        if (atual && item.episodio < atual.episode_count) { T = item.temporada; E = item.episodio + 1; }
        else {
          const prox = temps.find((s) => s.season_number > item.temporada);
          if (!prox) return erro("Você já está no último episódio");
          T = prox.season_number; E = 1;
        }
      }
      minutos = (t.episode_run_time || [])[0] || null;
    }
    if (!(T >= 1 && E >= 1)) return erro("Episódio inválido");
    const st = [];
    if (b.visto === false) {
      st.push(DB.prepare("DELETE FROM vistos WHERE item_id = ? AND temporada = ? AND episodio = ?").bind(item.id, T, E));
    } else if (b.ateAqui) {
      // todas as temporadas anteriores + esta até o episódio E
      const t = await tmdb(env, `/tv/${id}`);
      for (const s of t.seasons || []) {
        if (s.season_number < 1 || s.season_number > T) continue;
        const fim = s.season_number === T ? E : s.episode_count;
        for (let e = 1; e <= fim; e++)
          st.push(DB.prepare("INSERT OR IGNORE INTO vistos (item_id, temporada, episodio, minutos, visto_em) VALUES (?, ?, ?, ?, ?)")
            .bind(item.id, s.season_number, e, (t.episode_run_time || [])[0] || null, agora()));
      }
    } else {
      st.push(DB.prepare("INSERT OR REPLACE INTO vistos (item_id, temporada, episodio, minutos, visto_em) VALUES (?, ?, ?, ?, ?)")
        .bind(item.id, T, E, minutos, agora()));
    }
    if (st.length) await DB.batch(st);
    // "onde parei" = último episódio visto (maior temporada/episódio)
    const ult = await DB.prepare("SELECT temporada, episodio FROM vistos WHERE item_id = ? ORDER BY temporada DESC, episodio DESC LIMIT 1").bind(item.id).first();
    const n = (await DB.prepare("SELECT COUNT(*) AS n FROM vistos WHERE item_id = ?").bind(item.id).first()).n;
    let status = item.status;
    if (n > 0 && (status === "quero" || status === "pausei")) status = "assistindo";
    if (item.total_eps && n >= item.total_eps) status = "terminei";
    await DB.prepare("UPDATE itens SET temporada = ?, episodio = ?, status = ?, atualizado_em = ? WHERE id = ?")
      .bind(ult?.temporada ?? null, ult?.episodio ?? null, status, agora(), item.id).run();
    const vistos = (await DB.prepare("SELECT temporada, episodio FROM vistos WHERE item_id = ?").bind(item.id).all()).results;
    return json({ meu: await DB.prepare("SELECT * FROM itens WHERE id = ?").bind(item.id).first(), vistos });
  }

  // perfil (o meu)
  if (p[0] === "perfil" && m === "GET" && !p[1]) return json(await perfilDe(DB, uid, true));

  // as outras pessoas do app (só vocês dois): quem são e o que estão vendo agora
  if (p[0] === "pessoas" && m === "GET") {
    const us = (await DB.prepare("SELECT id, usuario, nome, foto FROM usuarios WHERE id != ? ORDER BY nome").bind(uid).all()).results;
    const vendo = (await DB.prepare(`SELECT i.usuario_id, i.tipo, i.tmdb_id, i.titulo, i.poster, i.ano, i.anime, i.status, i.temporada, i.episodio, i.favorito, i.nota
      FROM itens i WHERE i.usuario_id != ? AND i.status = 'assistindo' ORDER BY i.atualizado_em DESC`).bind(uid).all()).results;
    return json({ pessoas: us.map(({ id, ...u }) => ({ ...u, vendo: vendo.filter((v) => v.usuario_id === id).slice(0, 12) })) });
  }
  // perfil de outra pessoa
  if (p[0] === "u" && p[1] && m === "GET") {
    const u = await DB.prepare("SELECT id FROM usuarios WHERE usuario = ?").bind(String(p[1]).toLowerCase()).first();
    if (!u) return erro("Perfil não encontrado", 404);
    return json(await perfilDe(DB, u.id, u.id === uid));
  }
  // foto de perfil: o app manda já recortada e reduzida (JPEG/WebP em data URL, até ~200 KB)
  if (p[0] === "perfil" && p[1] === "foto" && m === "PUT") {
    const b = await corpo();
    const foto = b.foto === null ? null : String(b.foto || "");
    if (foto !== null && !/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(foto)) return erro("Imagem inválida");
    if (foto && foto.length > 280000) return erro("Imagem grande demais");
    await DB.prepare("UPDATE usuarios SET foto = ? WHERE id = ?").bind(foto, uid).run();
    return json({ ok: true, foto });
  }
  if (p[0] === "perfil" && m === "PUT") {
    const b = await corpo();
    await DB.prepare("UPDATE usuarios SET nome = COALESCE(?, nome), bio = ? WHERE id = ?").bind(texto(b.nome, 40), texto(b.bio, 300), uid).run();
    return json({ ok: true });
  }

  return erro("Rota não encontrada", 404);
}

// perfil com estatísticas + listas (favoritos, vendo agora, reviews)
async function perfilDe(DB, id, eu) {
  const u = await DB.prepare("SELECT usuario, nome, bio, foto, criado_em FROM usuarios WHERE id = ?").bind(id).first();
  const itens = (await DB.prepare(`SELECT i.*, (SELECT COUNT(*) FROM vistos v WHERE v.item_id = i.id) AS vistos_n
    FROM itens i WHERE i.usuario_id = ? ORDER BY i.atualizado_em DESC`).bind(id).all()).results;
  const ep = await DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(v.minutos), 0) AS min FROM vistos v JOIN itens i ON i.id = v.item_id WHERE i.usuario_id = ?`).bind(id).first();
  return {
    ...u,
    eu,
    stats: {
      filmes: itens.filter((i) => i.tipo === "movie" && i.status === "terminei").length,
      series: itens.filter((i) => i.tipo === "tv" && !i.anime && i.status === "terminei").length,
      animes: itens.filter((i) => i.anime && i.status === "terminei").length,
      episodios: ep.n,
      horas: Math.round(ep.min / 60),
      reviews: itens.filter((i) => i.review).length,
    },
    itens,
  };
}

// ---------- demonstração ----------
const DEMO = {
  visitante: { usuario: "demo", nome: "Visitante", bio: "Conta de demonstração. Pode mexer à vontade: os dados voltam ao normal sozinhos." },
  amiga: { usuario: "ana", nome: "Ana", bio: "Anime antes de dormir, filme no domingo." },
  // [tipo, tmdb_id, dados, episódio até onde marcar]
  itensVisitante: [
    ["tv", 94605, { status: "assistindo" }, [1, 6]],          // Arcane
    ["tv", 209867, { status: "assistindo" }, [1, 10]],        // Frieren
    ["tv", 100088, { status: "assistindo" }, [1, 4]],         // The Last of Us
    ["movie", 157336, { status: "terminei", nota: 4.5, favorito: 1, review: "Revi pela terceira vez e a trilha ainda me arrepia. A cena da doca é cinema puro." }],
    ["movie", 372058, { status: "terminei", nota: 5, favorito: 1 }],   // Your Name
    ["movie", 693134, { status: "quero" }],                   // Duna: Parte Dois
    ["tv", 119051, { status: "quero" }],                      // Wandinha
  ],
  itensAmiga: [
    ["tv", 94605, { status: "terminei", nota: 5, favorito: 1, review: "A Jinx merecia mais abraço. O episódio 9 me destruiu, e a animação é de outro planeta." }, [1, 9]],
    ["tv", 209867, { status: "assistindo" }, [1, 20]],
    ["tv", 95479, { status: "assistindo" }, [1, 12]],         // Jujutsu Kaisen
    ["movie", 157336, { status: "terminei", nota: 4, review: "Lindo, mas confesso que dormi um pouquinho na primeira hora." }],
  ],
};

async function contaDemo(env, d) {
  let u = await env.DB.prepare("SELECT * FROM usuarios WHERE usuario = ?").bind(d.usuario).first();
  if (u) return u;
  const sal = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO usuarios (usuario, nome, bio, senha_hash, sal, criado_em) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(d.usuario, d.nome, d.bio, await hashSenha(crypto.randomUUID(), sal), sal, agora()).run();
  return env.DB.prepare("SELECT * FROM usuarios WHERE usuario = ?").bind(d.usuario).first();
}

async function semearItens(env, uid, lista) {
  const DB = env.DB;
  await DB.prepare("DELETE FROM itens WHERE usuario_id = ?").bind(uid).run();
  for (const [tipo, id, dados, ate] of lista) {
    const item = await garantirItem(env, uid, tipo, id);
    const st = [];
    if (ate) {
      const t = await tmdb(env, `/tv/${id}`);
      const [T, E] = ate;
      for (const s of t.seasons || []) {
        if (s.season_number < 1 || s.season_number > T) continue;
        const fim = s.season_number === T ? E : s.episode_count;
        for (let e = 1; e <= fim; e++)
          st.push(DB.prepare("INSERT OR IGNORE INTO vistos (item_id, temporada, episodio, minutos, visto_em) VALUES (?, ?, ?, ?, ?)")
            .bind(item.id, s.season_number, e, (t.episode_run_time || [])[0] || 24, agora()));
      }
      st.push(DB.prepare("UPDATE itens SET temporada = ?, episodio = ? WHERE id = ?").bind(T, E, item.id));
    }
    st.push(DB.prepare(`UPDATE itens SET status = ?, nota = ?, favorito = ?, review = ?, review_em = ?, atualizado_em = ? WHERE id = ?`)
      .bind(dados.status, dados.nota ?? null, dados.favorito ?? 0, dados.review ?? null, dados.review ? agora() : null, agora(), item.id));
    await DB.batch(st);
  }
}

async function prepararDemo(env) {
  const DB = env.DB;
  const visitante = await contaDemo(env, DEMO.visitante);
  const amiga = await contaDemo(env, DEMO.amiga);
  const ult = await DB.prepare("SELECT v FROM meta WHERE k = 'demo_reset'").first();
  if (!ult || Date.now() - Number(ult.v) > 15 * 60e3) {
    await DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('demo_reset', ?)").bind(String(Date.now())).run();
    await DB.batch([
      DB.prepare("UPDATE usuarios SET nome = ?, bio = ?, foto = NULL WHERE id = ?").bind(DEMO.visitante.nome, DEMO.visitante.bio, visitante.id),
      DB.prepare("UPDATE usuarios SET nome = ?, bio = ? WHERE id = ?").bind(DEMO.amiga.nome, DEMO.amiga.bio, amiga.id),
    ]);
    await semearItens(env, amiga.id, DEMO.itensAmiga);
    await semearItens(env, visitante.id, DEMO.itensVisitante);
  }
  return visitante;
}

async function mapaMeus(DB, uid) {
  const r = await DB.prepare("SELECT tipo, tmdb_id, status, temporada, episodio, favorito FROM itens WHERE usuario_id = ?").bind(uid).all();
  return Object.fromEntries(r.results.map((i) => [i.tipo + ":" + i.tmdb_id, i]));
}

// Cria o item na lista (com título/pôster da TMDB) se ainda não existir
async function garantirItem(env, uid, tipo, id) {
  const DB = env.DB;
  let item = await DB.prepare("SELECT * FROM itens WHERE usuario_id = ? AND tipo = ? AND tmdb_id = ?").bind(uid, tipo, id).first();
  if (item) return item;
  const t = await tmdb(env, `/${tipo}/${id}`);
  const r = resumo(t, tipo);
  await DB.prepare(`INSERT INTO itens (usuario_id, tipo, tmdb_id, titulo, poster, ano, anime, status, total_eps, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'quero', ?, ?, ?)`)
    .bind(uid, tipo, id, r.titulo, r.poster, r.ano, r.anime ? 1 : 0, t.number_of_episodes || null, agora(), agora()).run();
  return DB.prepare("SELECT * FROM itens WHERE usuario_id = ? AND tipo = ? AND tmdb_id = ?").bind(uid, tipo, id).first();
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(req, env, url);
      } catch (e) {
        return erro(e.message || "Erro no servidor", 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
