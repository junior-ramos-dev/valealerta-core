# Deploy do Vale Alerta SC (Supabase + EC2 + Caddy)

O cidadão acessa **um domínio HTTPS** na EC2. Auth e polígonos ficam no **Supabase**. O React **não** roda no servidor: a Ubuntu só entrega o `dist/` e faz proxy de Copernicus e ANA.

Não use Amplify, S3-only nem “custom domain” do Supabase para hospedar o app. Custom domain no Supabase só troca o hostname da **API** (`*.supabase.co`).

O Python (`backend-satellite/fetch_hydro.py`) é **opcional**. A previsão de 12 h / 7 dias vem do **Open-Meteo no navegador**. Cron horário não é necessário na beta.

---

## 1. O que precisa estar no ar

| Peça | Onde |
| --- | --- |
| Dashboard (`frontend-dashboard/dist`) | `/var/www/valealerta` na EC2 |
| `/copernicus-dem/*` | Caddy → `copernicus-dem-30m.s3.eu-central-1.amazonaws.com` |
| `/ana-hidro/*` | Caddy → `telemetriaws1.ana.gov.br` |
| Contas, `profiles`, `topo_patch_reports` | Projeto Supabase |
| Open-Meteo, Esri, CARTO | O browser chama direto (HTTPS público) |
| Domínio | Registro.br (`.br`) ou registrar `.com` / `.net`; **A** → IP elástico da EC2 |

Variáveis Vite (`VITE_SUPABASE_*`) entram **na hora do `npm run build`**. Trocar o `.env` depois de copiar o `dist/` não altera o JS já gerado.

---

## 2. Supabase

1. Crie o projeto. Ative **PostGIS** (Database → Extensions).
2. SQL Editor: rode `backend-database/migrations.sql` (inclui `preferred_region_id` / `preferred_city_id`).
3. **Settings → API**: copie **Project URL** e a chave **anon** / **Publishable** (`sb_publishable_…` ou JWT `anon`). Nunca `service_role` nem senha do Postgres no frontend.
4. **Authentication → URL Configuration**
   - **Site URL:** `https://SEU_DOMINIO` (depois que o HTTPS existir).
   - **Redirect URLs:** `https://SEU_DOMINIO/**` e, se ainda desenvolver local: `http://localhost:5173/**`, `http://localhost:4173/**`.
5. **Authentication → Providers → Email:** na beta fechada pode desligar **Confirm email** (o `signUp` já devolve sessão). Com confirmação ligada, o link do e-mail usa a Site URL — `localhost` não abre no celular.
6. Modelos de e-mail em português exigem plano pago ou SMTP próprio (free novo não edita o template no SMTP da Supabase). Adiável na beta.
7. Primeiro admin (SQL), com o `id` em Authentication → Users:

```sql
update public.profiles set role = 'admin' where id = '<auth uid>';
```

---

## 3. Build na sua máquina

```bash
cd frontend-dashboard
cp .env.example .env.production
```

Edite `.env.production` (o Vite lê isso no `build`):

```bash
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

```bash
npm ci
npm run build
```

Saída: `frontend-dashboard/dist/` (incluindo `assets/maplibre-gl-worker.mjs` e `maplibre-gl-shared.mjs` — o MapLibre 6 pede-os ao lado do JS principal). Sem as variáveis `VITE_SUPABASE_*` o app publicado cai no modo local (senha `123`).

---

## 4. EC2 (Lightsail é o mesmo desenho)

1. Ubuntu 24.04, 1 vCPU / 1 GB basta na beta. Região **São Paulo** (`sa-east-1`).
2. **Elastic IP** — senão o A muda ao parar a instância.
3. Security group: **22** (SSH), **80** (HTTP + Let’s Encrypt), **443** (HTTPS). Sem a 443 o Caddy redireciona para um HTTPS que nunca abre.
4. DNS: registro **A** do domínio (e `www` se quiser) → o Elastic IP. Sem CNAME para `*.supabase.co`.

SSH (usuário `ubuntu` na AMI Ubuntu; `ec2-user` na Amazon Linux):

```bash
ssh -i /caminho/chave.pem ubuntu@IP_ELASTICO
```

Arquivos: **SFTP na porta 22** (FileZilla) ou `scp`/`rsync`. Não abra FTP (21).

---

## 5. Caddy na Ubuntu

```bash
sudo apt update
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
sudo mkdir -p /var/www/valealerta
sudo chown -R ubuntu:ubuntu /var/www/valealerta
```

### Publicar o `dist/`

Na sua máquina:

```bash
rsync -avz --delete -e "ssh -i /caminho/chave.pem" \
  frontend-dashboard/dist/ \
  ubuntu@IP_ELASTICO:/var/www/valealerta/
```

### `/etc/caddy/Caddyfile`

O arquivo é do **root**. Abra com `sudo vi` / `sudo nano` / `sudo -e`. Se o `vi` já estiver sem sudo, `:wq` falha; aí `:w !sudo tee %` funciona, mas o reload ainda é obrigatório.

**Enquanto o DNS não resolve** (teste pelo IP, só HTTP):

```caddy
{
	auto_https off
}

:80 {
	encode gzip
	root * /var/www/valealerta

	handle_path /copernicus-dem/* {
		reverse_proxy https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com {
			header_up Host copernicus-dem-30m.s3.eu-central-1.amazonaws.com
		}
	}

	handle_path /ana-hidro/* {
		reverse_proxy https://telemetriaws1.ana.gov.br {
			header_up Host telemetriaws1.ana.gov.br
		}
	}

	handle {
		try_files {path} /index.html
		file_server
	}
}
```

Não use `https://IP:80/` — porta 80 é HTTP.

**Com o A publicado** (troque o domínio; tire o `auto_https off`):

```caddy
SEU_DOMINIO {
	encode gzip
	root * /var/www/valealerta

	handle_path /copernicus-dem/* {
		reverse_proxy https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com {
			header_up Host copernicus-dem-30m.s3.eu-central-1.amazonaws.com
		}
	}

	handle_path /ana-hidro/* {
		reverse_proxy https://telemetriaws1.ana.gov.br {
			header_up Host telemetriaws1.ana.gov.br
		}
	}

	handle {
		try_files {path} /index.html
		file_server
	}
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

O Let’s Encrypt só fecha se o **A** já aponta para esta EC2 e a **80** está aberta. Não fique em `reload` a cada 10 s (limite de tentativas).

---

## 6. Testes de conectividade

No Mac, DNS:

```bash
dig +short SEU_DOMINIO A
```

Tem que sair o Elastic IP, não um endereço `supabase.co`.

HTTP no IP (fase `auto_https off`):

```bash
curl -I http://IP_ELASTICO/
```

Esperado: `200`, `Content-Type: text/html`, `Server: Caddy`.

ANA — **não use `-I`** (HEAD). O `.asmx` da ANA devolve **405** em HEAD; isso é normal e ainda prova que o proxy chegou lá (`Via: 1.1 Caddy`, `Server: nginx` da ANA).

```bash
curl -sS -o /tmp/ana.xml -w "%{http_code}\n" \
  "http://IP_ELASTICO/ana-hidro/ServiceANA.asmx/DadosHidrometeorologicos?codEstacao=84095500&dataInicio=01/09/2026&dataFim=10/09/2026"
head /tmp/ana.xml
```

Esperado: `200` e XML `DataTable` / `DadosHidrometereologicos`. Estação `84095500` = São João Batista (pacote Tijucas).

Copernicus (o mapa pede um COG; um 403/404 do S3 ainda mostra que saiu da EC2):

```bash
curl -I http://IP_ELASTICO/copernicus-dem/
```

Com domínio + certificado:

```bash
curl -I http://SEU_DOMINIO/
curl -I https://SEU_DOMINIO/
```

HTTP deve redirecionar (301/308) para HTTPS. HTTPS: `200` + `Server: Caddy`.

Antes do DNS público, forçar o nome no curl:

```bash
curl -I --resolve SEU_DOMINIO:80:IP_ELASTICO http://SEU_DOMINIO/
```

---

## 7. Troubleshooting

| Sintoma | Causa típica |
| --- | --- |
| `curl` em `/ana-hidro` com cookie `Domain=supabase.co` e `cf-ray` | Host errado: você bateu na URL do **projeto Supabase**, não no domínio da EC2. |
| JSON 404, `server: cloudflare` | Idem. |
| `405 Method Not Allowed` no `.asmx` com `curl -I` | HEAD recusado pela ANA. Repita com GET (comando da secção 6). |
| HTTP `500` + `SqlException` / `Execution Timeout Expired` | Timeout **no SQL da ANA**. Retry; não é o Caddy. Janela de datas menor ajuda. |
| HTTPS na porta 80 / `curl https://IP:80` | Esquema errado. 80 = `http://`. 443 = `https://`. |
| HTTP 200 no IP, HTTPS do domínio falha | Security group sem **443**, ou DNS ainda não no Elastic IP, ou Caddy ainda com `auto_https off`. |
| `dig` não mostra o IP da EC2 | TTL do Registro.br; espere. Confira se não criou CNAME para Supabase. |
| Mapa sem heatmap / sem cota ANA, mas o HTML abre | `dist/` antigo, Caddyfile sem `handle_path`, ou worker do MapLibre em falta (linha seguinte). |
| `text/html` em `/assets/*.js` ou `maplibre-gl-worker.mjs` | SPA fallback: ficheiro em falta no `dist/`. O `vite build` copia `maplibre-gl-worker.mjs` e `maplibre-gl-shared.mjs` para `dist/assets/`. Sem o worker o heatmap some; o hillshade pode até aparecer. Recarregue de janela anônima se o PWA antigo ainda servir HTML nesse URL. |
| Login local senha `123` em produção | Build **sem** `VITE_SUPABASE_*`. Rebuild + `rsync`. |
| Confirmação de e-mail aponta para localhost | Site URL do Supabase ainda em `localhost`. |
| Let’s Encrypt falha no log | `sudo journalctl -u caddy -n 80 --no-pager` — DNS, porta 80, ou excesso de tentativas ACME. |
| `:wq` recusado no Caddyfile | Arquivo do root. `sudo -e /etc/caddy/Caddyfile`. |

Na EC2:

```bash
sudo systemctl status caddy
sudo journalctl -u caddy -n 80 --no-pager
ls -la /var/www/valealerta
```

---

## 8. Depois que o HTTPS abrir

1. Supabase: Site URL + Redirect = `https://SEU_DOMINIO`.
2. Abra o domínio, aba **Simulação**, **Baixar bacia para o dispositivo** (PWA). Detalhes: [PWA.md](PWA.md).
3. Aba **Ferramentas**: cadastro/login no Supabase.
4. Atualizar o site: `npm run build` + `rsync` de novo. Só `reload` no Caddy se o `Caddyfile` mudou.

PWA e service worker: origin único `https://SEU_DOMINIO` (`/`, `/sw.js`, `/manifest.webmanifest`). Não publique o app num subpath sem ajustar o manifest.

---

## 9. O que não fazer

- Copiar `dist/` para o Supabase (não é o host do dashboard).
- Amplify / Pages / S3 sem os dois proxies.
- SMTP “no localhost” — o e-mail sai da nuvem Supabase; o que quebra é o **redirect** da confirmação.
- Worker Python 24/7 só porque existe `fetch_hydro.py`.
