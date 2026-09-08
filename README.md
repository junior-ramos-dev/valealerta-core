# 🌊 Vale Alerta — Simulador Cidadão de Inundação Regional

O **Vale Alerta** é uma plataforma web interativa, de código aberto e ultra-leve, desenvolvida para traduzir previsões meteorológicas complexas em informações visuais simples, práticas e acionáveis para o cidadão comum.

Focado inicialmente na bacia do **Vale do Rio Tijucas** (envolvendo as cidades de **Rancho Queimado**, **Angelina**, **Major Gercino**, **Nova Trento**, **São João Batista**, **Canelinha** e **Tijucas**), o projeto foi arquitetado de forma **independente de localização**. Qualquer desenvolvedor no mundo pode clonar este repositório, alterar as coordenadas no arquivo de configuração e implantar a ferramenta para sua própria comunidade ou bacia hidrográfica.

---

## 🎯 Propósito e Motivação

Mudar-se, salvar os móveis ou ficar em casa? Quem vive em regiões propensas a enchentes conhece a angústia de ouvir alertas de *"150 milímetros de chuva nas próximas horas"*. Para a maioria das pessoas, esse número não faz sentido na prática. Ninguém sabe se essa chuva vai apenas molhar a calçada ou cobrir o telhado.

O Vale Alerta resolve esse problema redesenhando a forma como a comunidade entende o risco climático, focando em dois pilares:

1. **Atualização Contra Terraformação Humana:** Antigamente, as gerações passadas sabiam de cabeça quando o rio subiria. Hoje, o crescimento urbano acelerado mudou as regras do jogo. Cada prédio construído, cada galpão asfaltado e cada terreno baixo aterrado alteram o caminho da água. Usando dados de relevo por satélite (Copernicus DEM), este simulador computa onde a água se acumula **no terreno da vista atual**, e não numa carta de 20 anos atrás.
2. **O Efeito Funil e Sincronização de Encostas:** O sol pode estar brilhando no centro de São João Batista, mas um temporal severo caindo simultaneamente nas montanhas de Major Gercino, Angelina e Rancho Queimado — ou no Ribeirão Alferes em Nova Trento — criará uma onda de cheia combinada que descerá o vale. O simulador ajuda o morador a olhar para o topo da montanha e antecipar o perigo com horas de antecedência.

O objetivo do projeto não é causar pânico, mas sim **trazer paz de espírito através da alfabetização climática**. O morador aprende a mexer nos controles (régua do rio, acúmulo previsto de chuva, horizonte de tempo) e vê no mapa **quantos centímetros de água cobrem cada trecho de terra**, sabendo quanto tempo de janela ele tem para se mover com segurança.

---

## ✨ Funcionalidades implementadas

### Mapa híbrido e navegação

- Mapa **Esri World Imagery** + rótulos transparentes **CARTO Positron Labels**, com MapLibre GL JS.
- Linha do **Rio Tijucas** (talvegue simplificado Angelina/Rancho Queimado → foz em Tijucas) e pontos das cidades.
- Seletor **Município do vale**: voa até Rancho Queimado, Angelina, Major Gercino, Nova Trento, São João Batista, Canelinha ou Tijucas, **mantendo os sliders atuais**.
- Após pan, zoom ou troca de cidade, o app **espera 1 segundo** e recarrega relevo + heatmap para a **área visível**.
- Ícones **i** em cada controle: a explicação aparece ao passar o mouse.

### Relevo Copernicus na vista

- Hillshade gerado no navegador a partir do **Copernicus DEM GLO-30** (COG 1° no S3 público).
- Slider de opacidade do overlay de relevo.
- A malha de altitudes da mesma cena alimenta o cálculo de inundação (água − terreno).

### Heatmap de profundidade no terreno

- Superfície d’água **plana** na vista: cota = leito amostrado no DEM + régua.
- Preenchimento hidrológico a partir do rio para as células mais baixas que essa cota.
- Cores por profundidade **local** (não um retângulo de corredor): **10, 25, 50, 75, 100 … 250 cm**.
- Três modos de camada: **Ocultar**, **Agora** (régua manual) e **Previsão 7d**.

### Régua do rio (modo Agora)

- Slider desde o **nível natural no leito** (0 m nesta régua), não o nível do mar absoluto.
- Em São João Batista, a Defesa Civil registra ruas alagadas a partir de **6 m** nesta régua (Ribanceira do Sul / Loteamento Piva). Picos documentados: **6,85 m** (maio/2024, SDR/SC) e cerca de **9 m** (dez/2022, Epagri/Ciram).
- A série ANA 84095500 (dezenas de cm em estiagem) usa o **mesmo zero** de estiagem, não a cota municipal de transbordo.

### Previsão de 7 dias (Open-Meteo)

- Slider **1–7 dias**: soma a precipitação horária prevista na captação a montante (Rancho Queimado, Angelina, Major Gercino).
- Subida estimada: `ΔH = chuva_mm × 0,05`. A cota no mapa é **cota ANA atual + ΔH**.
- A camada **Previsão 7d** usa as **mesmas cores** de profundidade sobre o DEM da tela.

### Escala cm ↔ mm/h

- Abaixo das cores: intensidade de chuva **mm/h sustentada por 3 h** para o rio transbordar (cota 6 m) e deixar aquela lâmina nas **primeiras áreas alagadas**.
- Fórmula de referência: `ΔH = chuva_mm × 0,05 + Q / 250` (Q = vazão ANA quando disponível).

### Tempo real e janela de escape

- Aba **Tempo Real**: cruza Open-Meteo × telemetria **ANA HidroWeb** (estações Major Gercino `84097760`, Nova Trento `84096000`, São João Batista `84095500`).
- Janela de escape: o pico em Major Gercino chega ao centro de SJB em cerca de **4 horas** (configurável).
- **Resetar para condições normais**: régua na cota ANA (ou ~30 cm), previsão no dia 1, camada “Agora”.

### Backend e configuração regional

- `backend-satellite/config.json`: bbox, cidades, lags, fórmula e cota de transbordo — ponto único para **reapontar o simulador a outra bacia**.
- `python3 backend-satellite/fetch_hydro.py`: baixa Open-Meteo (7 dias) + ANA e grava `data/hydro_now.json` (e `frontend-dashboard/public/hydro_now.json` se existir).
- `backend-database/migrations.sql`: esquema PostGIS/Supabase para **perfis** e **pins de risco comunitário** (estrutura pronta; o mapa cidadão ainda não consome esses pins).

---

## 🏗️ Arquitetura do sistema e fontes de dados

Para carregar rápido em celulares com sinal fraco, o cálculo de inundação roda **no navegador**: o DEM da viewport é mosaicado, o heatmap é rasterizado em canvas e sobreposto no MapLibre (WebGL). Não há servidor de tiles de inundação.

```text
 ☁️ [CRON OPCIONAL — Python]
    ├── Open-Meteo (precipitação horária, 7 dias)
    ├── ANA HidroWeb (cota e vazão)
    └── Escreve hydro_now.json
         │
         ▼
 📱 [DASHBOARD — Vite + React + MapLibre]
    ├── Mapa híbrido Esri + CARTO
    ├── Proxy Vite → Copernicus GLO-30 (S3) e ANA (sem CORS no S3/ANA)
    ├── Open-Meteo direto no cliente (7 dias)
    └── Heatmap: DEM da vista − lâmina (régua ou previsão)
```

O diagrama abaixo descreve a **visão-alvo** do produto (radar Sentinel-1, Supabase alimentado pelo cron, deep links). Itens ainda não ligados ao dashboard estão marcados na seção *Roadmap*.

```text
 ☁️ [SERVER CRON JOB]          (parcialmente implementado: fetch_hydro.py)
    ├── 1. Coleta previsões (Open-Meteo) e níveis de rios (ANA)
    ├── 2. Radar Sentinel-1 SAR          → planejado
    └── 3. Banco (Supabase / PostGIS)    → migrations prontas
         │
         ▼
 📱 [APLICATIVO DO CIDADÃO (React + MapLibre)]
    ├── Mapa híbrido (Esri + CARTO)
    └── Overlay de profundidade vs. topografia da tela
```

### 🛰️ Fontes de dados (gratuitas e públicas)

| Uso | Fonte | Como entra no app |
| --- | --- | --- |
| Imagens de satélite | **Esri World Imagery** | Tiles no MapLibre |
| Nomes e eixos | **CARTO Positron Labels** (dados OpenStreetMap) | Overlay de rótulos |
| Altitude / hillshade / inundação | **Copernicus DEM GLO-30** (30 m, COG no S3 `copernicus-dem-30m`, catálogo CDSE) | Proxy Vite `/copernicus-dem`; leitura GeoTIFF no browser (`geotiff`) |
| Chuva prevista 7 dias | **Open-Meteo Forecast API** (`hourly=precipitation`, `forecast_days=7`, sem API key; modelos GFS, ECMWF e outros) | `frontend-dashboard/src/hydro.ts` e `fetch_hydro.py` |
| Cota e vazão | **ANA HidroWeb** — `ServiceANA.asmx/DadosHidrometeorologicos` | Proxy Vite `/ana-hidro` |
| Cota de transbordo SJB | **Defesa Civil / Prefeitura de São João Batista**; picos **SDR/SC** e **Epagri/Ciram** | Constante `sjb_spill_stage_m = 6` em `config.json` / `hydro.ts` |
| Esquema espacial | **PostGIS** (Supabase) | `backend-database/migrations.sql` |
| Radar de validação | **Sentinel-1 SAR (ESA / CDSE)** | Planejado (não no dashboard atual) |
| Terrain-RGB (MapTiler/AWS) | Tiles Terrarium | Fonte declarada no estilo; o overlay operacional é o GLO-30 |

Endpoints úteis:

- Open-Meteo: `https://api.open-meteo.com/v1/forecast`
- Copernicus GLO-30: `https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/`
- ANA: `https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos`

---

## 🛠️ Tecno-stack

* **Frontend:** Vite + React + TypeScript (`frontend-dashboard/`).
* **Mapas:** MapLibre GL JS.
* **DEM:** `geotiff` + hillshade/inundação em canvas (`copernicusDem.ts`, `inundation.ts`).
* **Hidrologia no cliente:** `hydro.ts` (Open-Meteo + ANA + fórmula de subida).
* **Python:** `backend-satellite/fetch_hydro.py` (stdlib + JSON; numpy não é obrigatório neste script).
* **Banco (preparado):** Supabase / PostgreSQL + PostGIS.
* **Ainda não no app:** Web Share API / deep link `?rain=&window=&lat=`, pins comunitários, Sentinel-1.

---

## 📁 Estrutura de pastas

```text
valealerta-core/
├── README.md
├── backend-satellite/
│   ├── config.json          # Bacia, cidades, lags, fórmula, cota 6 m
│   ├── fetch_hydro.py       # Open-Meteo 7d + ANA → hydro_now.json
│   └── data/hydro_now.json
├── backend-database/
│   └── migrations.sql       # profiles + hazard_pins (PostGIS / RLS)
└── frontend-dashboard/
    ├── vite.config.ts       # Proxies Copernicus e ANA
    ├── public/hydro_now.json
    └── src/
        ├── App.tsx          # Mapa, abas, sliders, camadas
        ├── InfoTip.tsx      # Ícones de ajuda
        ├── copernicusDem.ts # COG GLO-30 + hillshade
        ├── inundation.ts    # Heatmap de profundidade
        └── hydro.ts         # Open-Meteo, ANA, cidades, régua
```

Para outra região: edite `backend-satellite/config.json` e as constantes de cidades / talvegue em `frontend-dashboard/src/hydro.ts`.

---

## 🚀 Como executar localmente (sem Docker)

### 1. Frontend

Requer **Node.js**. O proxy do Vite é necessário para o DEM Copernicus (S3 sem CORS) e para a ANA.

```bash
cd frontend-dashboard
npm install
npm run dev
```

Abra o endereço do terminal (em geral `http://localhost:5173`). O mapa inicia em São João Batista; use o seletor de município e os modos **Agora** / **Previsão 7d**.

### 2. Pipeline de dados (Python, opcional)

O dashboard já consulta Open-Meteo e ANA no navegador. O script gera um JSON de apoio:

```bash
cd backend-satellite
python3 fetch_hydro.py
```

Saídas: `backend-satellite/data/hydro_now.json` e, se a pasta existir, `frontend-dashboard/public/hydro_now.json`.

### 3. Banco (opcional)

Execute `backend-database/migrations.sql` num projeto Supabase (PostGIS + `auth.users`).

---

## 🤝 Como contribuir

Este é um ecossistema construído pela comunidade para a proteção da comunidade. Abra uma *Issue* ou um *Pull Request*. Frentes em aberto:

* Integração com feeds da Defesa Civil Estadual (Epagri/Ciram, DCSC).
* Sentinel-1 para validar a mancha de água sob nuvens.
* Deep links (`?rain=&days=&lat=&lng=`) e Web Share para WhatsApp.
* Ligar `hazard_pins` do PostGIS ao mapa.
* LiDAR municipal (1 m) no lugar do GLO-30 onde existir.

---

## 🤖 Desenvolvimento com apoio de IAs

O Vale Alerta foi construído em conjunto com assistentes de inteligência artificial, sempre com revisão humana das decisões de produto, hidrologia e código.

* **Gemini:** estudo de viabilidade — quais fontes públicas (Open-Meteo, ANA HidroWeb, Copernicus DEM, Sentinel-1) são acessíveis sem custo, quais limitações de CORS/API existem, e **protótipos iniciais** da ideia (mapa, régua, pipeline de dados).
* **Cursor:** a **implementação atual** do repositório (dashboard MapLibre, heatmap de profundidade no DEM, hidrologia no cliente, schema PostGIS e este README).

As IAs aceleram pesquisa e iteração; a responsabilidade pelo que entra no mapa e na fórmula de subida d’água permanece com quem mantém o projeto.

---

## 📄 Licença

Este projeto está sob a licença MIT — sinta-se livre para usar, modificar, distribuir e adaptar para proteger as vidas e o patrimônio dos cidadãos da sua região.
