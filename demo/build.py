#!/usr/bin/env python3
"""Costruisce demo/dist/simulatore.html: un file unico con il vero codice dell'app
(telefono, regia, LED, motore dello show) e un server simulato dentro la pagina.
Uso: python3 demo/build.py"""
import base64, json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = ROOT / 'public'
out_dir = ROOT / 'demo' / 'dist'
out_dir.mkdir(parents=True, exist_ok=True)

def data_uri(path):
    ext = path.suffix.lower()
    mime = {'.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif'}[ext]
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()

IMG = {f'/img/{p.relative_to(P / "img").as_posix()}': data_uri(p) for p in (P / 'img').rglob('*') if p.is_file()}

def inline_imgs(text):
    for k, v in IMG.items():
        text = text.replace(k, v)
    return text

# ---------- CSS ----------
def strip_comments(css):
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)

def find_block_end(s, i):
    depth = 0
    while i < len(s):
        if s[i] == '{': depth += 1
        elif s[i] == '}':
            depth -= 1
            if depth == 0: return i
        i += 1
    raise ValueError('CSS non bilanciato')

KEEP_GLOBAL = ('.fly', '.tired')

def prefix_sel(sel, pre):
    parts = []
    for s in sel.split(','):
        s = s.strip()
        if not s: continue
        if any(k in s for k in KEEP_GLOBAL): parts.append(s)
        elif re.match(r'^(html|body|:root)\b', s): parts.append(re.sub(r'^(html|body|:root)\b', pre, s))
        else: parts.append(f'{pre} {s}')
    return ', '.join(dict.fromkeys(parts))

def prefix_css(css, pre, media_to_container=None):
    css = strip_comments(css)
    css = re.sub(r'@import[^;]+;', '', css)
    out, i = [], 0
    while True:
        j = css.find('{', i)
        if j < 0: break
        prelude = css[i:j].strip()
        end = find_block_end(css, j)
        body = css[j + 1:end]
        if prelude.startswith('@media'):
            q = prelude
            if media_to_container: q = q.replace('@media', f'@container {media_to_container}')
            out.append(f'{q} {{ {prefix_css(body, pre)} }}')
        elif prelude.startswith('@'):
            out.append(f'{prelude} {{{body}}}')
        else:
            out.append(f'{prefix_sel(prelude, pre)} {{{body}}}')
        i = end + 1
    return '\n'.join(out)

theme = inline_imgs(re.sub(r'@import[^;]+;', '', (P / 'css/theme.css').read_text()))
app_css = inline_imgs(prefix_css((P / 'css/app.css').read_text(), '#phoneScreen'))
regia_css = inline_imgs(prefix_css((P / 'css/regia.css').read_text(), '#regiaRoot', media_to_container='regia'))
# la regia vive in un contenitore, non a tutto schermo
regia_css = regia_css.replace('height: 100vh;', 'height: 100%;').replace('min-height: 100vh;', 'min-height: 100%;')
app_css = app_css.replace('min-height: 100dvh;', 'min-height: 100%;')

# ---------- markup regia ----------
regia_html = (P / 'regia.html').read_text()
regia_markup = regia_html.split('<body>')[1].split('<script')[0]
regia_markup = inline_imgs(regia_markup).replace('placeholder="Password regia"', 'placeholder="Qualsiasi password (demo)"')

# ---------- JS: moduli impacchettati senza build ----------
def module(path, code=None):
    code = code if code is not None else path.read_text()
    code = re.sub(r"^import\s+\{([^}]+)\}\s+from\s+'[^']+';", lambda m: f"const {{{m.group(1)}}} = CP;", code, flags=re.M)
    exports = re.findall(r'^export\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z0-9_$]+)', code, flags=re.M)
    code = re.sub(r'^export\s+', '', code, flags=re.M)
    tail = f"\nObject.assign(CP, {{ {', '.join(exports)} }});" if exports else ''
    return f"// ---- {path.relative_to(ROOT)} ----\n(() => {{\n{code}{tail}\n}})();\n"

engine_src = (ROOT / 'server/engine.js').read_text().replace(
    "import { randomUUID } from 'node:crypto';",
    "const randomUUID = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2));")
config_src = (ROOT / 'server/config.js').read_text().replace("import { readFileSync } from 'node:fs';", "const readFileSync = () => { throw new Error('non disponibile'); };")
app_src = inline_imgs((P / 'js/app.js').read_text()).replace('window.scrollTo(0, 0);', "document.getElementById('phoneScreen').scrollTop = 0;")
regia_src = re.sub(r"\n\s*document\.title = .*?;\n", "\n", (P / 'js/regia.js').read_text())
card_src = inline_imgs((P / 'js/card.js').read_text())

cfg = json.loads((ROOT / 'config/show.json').read_text())
for c in cfg['concorrenti']:
    c['foto'] = IMG.get('/' + c['foto'], c['foto'])
if cfg['show'].get('gifVotiChiusi'):
    cfg['show']['gifVotiChiusi'] = IMG.get('/' + cfg['show']['gifVotiChiusi'], cfg['show']['gifVotiChiusi'])
itc = cfg['show'].get('intro', {})
if itc.get('logoPartner'): itc['logoPartner'] = IMG.get('/' + itc['logoPartner'], itc['logoPartner'])
if itc.get('fotoPersona'): itc['fotoPersona'] = IMG.get('/' + itc['fotoPersona'], itc['fotoPersona'])
vcc = cfg['show'].get('votazioniChiuse', {})
if vcc.get('immagineLed'): vcc['immagineLed'] = IMG.get('/' + vcc['immagineLed'], vcc['immagineLed'])
for pr in cfg.get('profili', []):
    if pr.get('locandina'): pr['locandina'] = IMG.get('/' + pr['locandina'], pr['locandina'])
for g in cfg.get('generazioni', []):
    g['immagine'] = IMG.get('/' + g['immagine'], g['immagine'])
import subprocess
qr = subprocess.run(['node', '-e', "require('qrcode').toDataURL('https://cultpop.it',{margin:1,width:640,color:{dark:'#17121f',light:'#ffffff'}}).then(u=>process.stdout.write(u))"], cwd=ROOT, capture_output=True, text=True, check=True).stdout

js = '\n'.join([
    'const CP = {};',
    f'window.__SHOW_CONFIG = {json.dumps(cfg, ensure_ascii=False)};',
    f'window.__QR = {json.dumps({"url": "https://cultpop.it (esempio)", "dataUrl": qr})};',
    module(P / 'js/deco.js'),
    module(P / 'js/card.js', card_src),
    module(P / 'js/idcard.js', inline_imgs((P / 'js/idcard.js').read_text())),
    module(P / 'js/led.js', inline_imgs((P / 'js/led.js').read_text())),
    module(ROOT / 'server/engine.js', engine_src),
    module(ROOT / 'server/config.js', config_src),
    module(ROOT / 'demo/runtime.js'),
    module(P / 'js/app.js', app_src),
    module(P / 'js/regia.js', regia_src),
])
js = js.replace('</script', '<\\/script')

shell = (ROOT / 'demo/shell.html').read_text()
html = (shell.replace('/*__THEME__*/', theme).replace('/*__APP__*/', app_css).replace('/*__REGIA__*/', regia_css)
        .replace('<!--__REGIA_MARKUP__-->', regia_markup).replace('/*__JS__*/', js))
html = inline_imgs(html)
(out_dir / 'simulatore.html').write_text(html)
print(f"ok: {out_dir / 'simulatore.html'} ({len(html) // 1024} KB)")
