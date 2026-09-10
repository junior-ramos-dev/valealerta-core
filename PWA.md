# Vale Alerta como PWA

O motor de inundação (régua − DEM → heatmap) **já roda no navegador** (telefone ou computador). A PWA existe para o app **abrir sem torre** e para não precisar baixar de novo o que já esteve no aparelho. Não há “ANA ao vivo” nem previsão nova sem internet.

O ícone (tela inicial, Dock ou janela própria) exige **HTTPS** (produção) ou **`localhost`** (desenvolvimento com o build). O `npm run dev` não registra o service worker.

Antes de uma cheia, com internet: abra o vale que interessa (aba **Simulação**) e toque **Baixar bacia para o dispositivo**. Sem esse passo, o app instalado é sobretudo o casco (JS/CSS e pacotes JSON); o heatmap some onde o Copernicus ainda não foi gravado.

Passo a passo de instalação: [desenvolvimento](#instalação-em-desenvolvimento) e [produção](#instalação-em-produção).

---

## Online

Com rede, o comportamento é o do dashboard “ao vivo”:

| Recurso | O que acontece |
| --- | --- |
| Casco do app | Carrega da rede; o service worker atualiza o precache em segundo plano. |
| Pacote da bacia (`regions/*.json`, patches) | Lê o JSON atual; também entra no cache para uso posterior. |
| Tempo Real / régua | Open-Meteo (chuva horária, 7 dias) e ANA HidroWeb (cota/vazão). A cota ANA é o **piso** da régua com Tempo Real ligado. |
| Retrato hidrológico | Cada leitura boa é gravada no IndexedDB com `fetched_at` (por bacia). |
| Copernicus DEM | COGs 1° da **vista** (proxy `/copernicus-dem`). Heatmap e hillshade usam essa malha. |
| Mapa de fundo | Tiles Esri World Imagery + rótulos CARTO; o que passar na tela fica em cache. |
| **Baixar bacia para o dispositivo** | Recarrega o pacote, grava o retrato hidro atual e baixa os COGs da **bbox inteira** da bacia (dezenas de MB). |

Não há faixa amarela no mapa enquanto a hidrologia vier da rede.

Demarcação de patches (aba **Ferramentas**, com login), município, sliders e ajuda funcionam iguais online ou offline — o cálculo é local.

---

## Offline (queda de luz / internet)

O que já estiver no aparelho continua utilizável. O que nunca foi baixado **não aparece**.

### O que funciona

- **Abrir o app** pelo ícone (precache: `index`, JS, CSS, ícones, `regions/*`, patches).
- **Trocar de bacia** entre pacotes já instalados no build (Tijucas, Itajaí, …).
- **Simular**: régua, transbordo, janela de tempo, overlay, heatmap **na malha DEM já gravada**.
- **Tempo Real** com a **última cota ANA conhecida** (não é telemetria do minuto). A previsão de chuva é a **última série Open-Meteo salva**; ela **envelhece**.
- **Patches** no `localStorage` (cache) e, com Supabase configurado e rede, em `topo_patch_reports`.
- **Basemap**: só os tiles de satélite/rótulo **já vistos**. Sem tile, o fundo pode ficar cinza; o heatmap ainda pinta se o DEM daquela vista estiver no cache.

### O que a faixa amarela significa

No canto do mapa:

- `Offline · cota ANA de HH:MM` — sem rede; hora do último retrato (fuso de São Paulo).
- `Sem dados ao vivo · última cota HH:MM` — o aparelho está “online”, mas Open-Meteo/ANA falharam e o app usou o IndexedDB.
- `Previsão de ontem` (ou a data) — o `fetched_at` não é o dia de hoje. A mancha Previsão **não** é a previsão meteorológica atual.

### O que não fica offline

| Pedido | Offline |
| --- | --- |
| Nova leitura ANA | Não. Continua a cota gravada (ou régua livre se nunca houve retrato). |
| Nova previsão Open-Meteo | Não. Usa a série antiga; o slider 1–7 dias e as 24 h são desse retrato. |
| Copernicus de área **não** baixada | Sem heatmap/hillshade nessa vista. Pan para fora da bbox preparada = buraco. |
| Tiles de mapa nunca vistos | Fundo vazio/cinza. |
| WhatsApp / Defesa Civil / feeds novos | Fora do PWA. |

Um install **sem** “Baixar bacia para o dispositivo” (e sem ter panado o vale com rede) deixa o cidadão com controles e pacote JSON, mas **sem relevo** para pintar a rua.

---

## O que é gravado onde

| Dado | Onde | Quando |
| --- | --- | --- |
| App (shell) + `regions/*.json` + patches + ícones | Precache do service worker | Install / `build` |
| Último Open-Meteo + ANA (`fetched_at`) | IndexedDB `valealerta` / store `hydro`, chave = id da bacia | Toda leitura boa; também no botão Baixar |
| COGs Copernicus da bbox | Cache API (`valealerta-copernicus-dem` e Workbox) | **Baixar bacia para o dispositivo**; COGs da vista também ao usar o mapa |
| Tiles Esri / CARTO / glifos MapLibre | Cache do service worker (só o já pedido) | Navegação no mapa |
| Bacia e patches locais | `localStorage` | Já existia antes da PWA |
| Demarcações (se o banco estiver ligado) | Supabase `topo_patch_reports` | Ao aplicar Δz com login; leitura pública da bacia |

O heatmap **não** é um arquivo salvo: é recalculado no aparelho (cota da água − z do DEM em cache).

---

## Instalação em desenvolvimento

Use isto no computador de quem desenvolve. O Chrome só trata `localhost` como instalável sem HTTPS.

1. No repositório:

   ```bash
   cd frontend-dashboard
   npm install
   npm run build
   npm run preview
   ```

   O terminal mostra a URL (em geral `http://localhost:4173`). Não use `npm run dev` para testar install: o worker não entra.

2. Abra essa URL no Chrome (mesmo PC, ou o celular na mesma rede só se o preview estiver em HTTPS — em HTTP o install no telefone **não** aparece).
3. Com internet: escolha a bacia (aba **Simulação**) e toque **Baixar bacia para o dispositivo**. Espere o “Pronto” (o DEM é grande).
4. Instale:
   - **Chrome (computador):** ícone de instalação na barra de endereço, ou menu ⋮ → **Instalar Vale Alerta**.
   - **Chrome (Android), se a página for `localhost` no próprio aparelho ou HTTPS:** menu → **Instalar aplicativo** / **Adicionar à tela inicial**.
5. Opcional: panear o trecho da cidade com rede para aquecer o basemap.

Para só desenvolver a UI, `npm run dev` continua válido; só não simula a PWA instalável.

---

## Instalação em produção

Quando o Vale Alerta estiver **no ar** (site público em **HTTPS**), o cidadão não precisa de Node nem do repositório. O service worker e o `manifest.webmanifest` vêm do próprio site.

### No celular (uso do dia a dia)

1. Com internet, abra o endereço de produção no **navegador** (Chrome no Android; Safari no iPhone). Não use aba anônima.
2. Escolha o vale (Tijucas, Itajaí, …) e toque **Baixar bacia para o dispositivo**. Espere **Pronto** — isso grava cota ANA/Open-Meteo e o relevo Copernicus da bacia.
3. Instale o aplicativo:
   - **Android (Chrome):** menu ⋮ → **Instalar aplicativo** ou **Adicionar à tela inicial**. Se o Chrome oferecer o banner **Instalar Vale Alerta**, aceite.
   - **iPhone / iPad (Safari):** botão Compartilhar → **Adicionar à Tela de Início** → Adicionar. O iOS não usa o mesmo prompt do Chrome; o atalho abre em tela cheia (`apple-mobile-web-app-capable`).
4. Abra pelo **ícone** na tela inicial (não pela aba do navegador). Com rede, Tempo Real e previsão atualizam; sem rede, vale o último retrato e o DEM já baixado.
5. Opcional: com internet, percorra no mapa o bairro que importa para o satélite também ficar em cache.

Repita o passo 2 quando mudar de bacia ou quiser um retrato hidro mais novo **antes** de perder a rede.

### No computador (Chrome / Edge)

1. Abra a URL HTTPS de produção.
2. **Baixar bacia para o dispositivo** (o cache fica neste navegador / nesta instalação).
3. Ícone de instalação na barra de endereço, ou menu → **Instalar Vale Alerta**. Abre em janela própria (`display: standalone`).

### Requisitos do site em produção

Sem isto o install não aparece ou o mapa/DEM quebram fora do `localhost`:

- Servir o conteúdo de `frontend-dashboard/dist` em **HTTPS** (mesmo origin para `/`, `/sw.js`, `/manifest.webmanifest`).
- Manter os proxies (ou equivalentes) de **`/copernicus-dem`** e **`/ana-hidro`**: no Vite eles só existem em `dev`/`preview`. Em produção o servidor (nginx, CDN + functions, etc.) precisa encaminhar esses caminhos; senão o heatmap e a cota ANA não carregam mesmo online.
- Não bloquear o service worker (cabeçalhos corretos para `sw.js`; não servir o app em um subpath sem ajustar `start_url` / `scope` no manifest).

Na cheia, o útil é **régua + última cota + relevo daquele vale**. Não é um radar nem um HidroWeb desconectado.
