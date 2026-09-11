# 🤝 Como Contribuir para o Vale Alerta SC

Seja bem-vindo ao projeto **Vale Alerta SC**. O motor (Copernicus DEM, Open-Meteo, flood-fill, régua, patches) é genérico. Cada bacia é um **pacote de região** em JSON — não é preciso alterar React para incluir um vale novo, desde que o JSON esteja completo e calibrado.

Há dois jeitos de ajudar: **demarcar obras de terra no mapa** (qualquer relator cadastrado) e **adicionar ou calibrar uma bacia** (JSON + PR). O primeiro melhora a mancha **já amanhã**; o segundo escala o app para outro vale.

## ⛰️ Demarcar relevo modificado (aterro ou escavação)

O heatmap usa o **Copernicus GLO-30**, que atrasa **anos** e mistura telhado/copa com o chão. Aterro, corte, dique e loteamento recente **não entram** no satélite. Sem correção, a água pinta o platô antigo (ainda “baixo” no modelo) e poupa o vizinho que, na rua, é quem alaga.

Quem vive no lugar pode **somar um Δz só no polígono da obra**:

```text
z_usado = z_Copernicus + Δz
```

Isso não vira GNSS nem parecer da Defesa Civil. Ajuda a simulação se a marcação ficar **o mais perto possível da área real e da altura (ou profundidade) real**. Detalhes de limite: `OPTIMIZATIONS.md`.

### Cadastrar

1. Abra o dashboard (`npm run dev` ou o host em produção).
2. Na barra, aba **Ferramentas** (a aba **Simulação** guarda régua, bacia e chuva).
3. Sem login, a aba mostra o aviso de que correções exigem cadastro e o formulário **Entrar | Cadastrar**.
4. **Com banco (Supabase):** em **Cadastrar**, informe nome, cidade/estado onde reside, **bacia** e **município padrão** ao abrir o app, e-mail e senha (papel relator). Confirme no e-mail do Vale Alerta SC e depois use **Entrar**. Peça a um admin se precisar ser validador.
5. **Sem banco:** **Cadastrar** ou **Entrar** com nome (2+ letras) + senha `123` — os polígonos ficam só neste navegador até existir projeto Supabase. Os padrões de bacia/cidade gravam neste aparelho.

### Como demarcar (área × altura)

1. **Demarcar área** e clique os vértices **colados no platô, no corte ou no dique** — não um retângulo “para caber o bairro”. O modelo aplica o Δz em cada célula de ~30 m cujo **centro** cai no polígono: folga demais aterra o vizinho; folga de menos deixa um corredor baixo falso.
2. Feche no **primeiro ponto** (verde), com duplo clique ou Enter. Confira a **área em m²** na barra (e o equivalente em campos de futebol **em área**, não em comprimento).
3. **Δz em metros**, relativo, não cota MSL:
   * aterro / platô: **positivo** (ex. +2 m);
   * escavação / corte: **negativo**.
4. Use a altura **da obra**, não um “ajuste fino”. O GLO-30 já erra **2–4 m** na vertical: um chute de 0,3 m some no ruído; **+2 m de platô** muda a mancha. Se a prefeitura mediu, use essa cota.
5. **Aplicar Δz**. Ligue **Simular inundação com correções de relevo** para ver a água sair do platô (o rio continua no GLO-30 cru; o volume que não cabe no aterro sobe a lâmina no entorno).

Vários relatores no mesmo sítio: o app **média o Δz** (um voto por pessoa). Área um pouco maior ou menor não desfaz o grupo; **altura** discordando ≥ 1 m fica vermelha até alguém conferir in loco.

### O que não fazer

- Inventar ANA, cota de transbordo ou “6 m de SJB” noutro município (`CONTRIBUTING.md` da bacia).
- Polígono enorme “para garantir” ou Δz redondo demais sem olhar a obra.
- Tratar a simulação hipotética como aviso oficial.

Quem puder validar no campo (papel **validador**): botão **validar in loco** na lista. Patches canônicos da bacia (já conferidos) entram em `regions/<id>.patches.geojson` via PR.

## 🌍 Como adicionar uma nova bacia

1. Copie `regions/tijucas.json` para `regions/<id>.json` (id em minúsculas, sem espaços: `itajai`, `itajaí` não). Copie também `regions/tijucas.patches.geojson` para `regions/<id>.patches.geojson` (pode começar vazio).
2. Inclua a entrada em `regions/index.json` (`id`, `name`, `state`, `target`).
3. Preencha o pacote (campos obrigatórios abaixo).
4. Rode o dashboard (`cd frontend-dashboard && npm run dev`) e escolha a bacia no seletor **Bacia**.
5. Calibre contra uma cheia histórica (veja homologação). Abra um PR descrevendo município-alvo, estações ANA e o evento de benchmark.

O Python usa o mesmo JSON:

```bash
python3 backend-satellite/fetch_hydro.py              # default em backend-satellite/config.json
VALEALERTA_REGION=itajai python3 backend-satellite/fetch_hydro.py
```

`backend-satellite/config.json` só aponta o `default_region`. **Não** coloque cidades ou talvegue lá.

### Campos do pacote (`regions/<id>.json`)

| Campo | Função |
| --- | --- |
| `id` | Mesmo id do arquivo e do `index.json` |
| `title` / `subtitle` | Cabeçalho da barra lateral |
| `river_name` | Linha do rio no mapa |
| `target_city_id` | Município-alvo (régua, zoom inicial, lag 0) |
| `surge_city_id` | Cidade cuja onda define a janela de escape padrão |
| `live_gauge_id` | Estação ANA usada como fallback de vazão/cota |
| `calibration.status` | `calibrated` ou `provisional` (mostra aviso amarelo) |
| `region.bbox` / `center` / `default_zoom` | Recorte e vista inicial |
| `cities[]` | `id`, `name`, `lat`, `lon`, `zoom`, `role`, `lag_to_target_h`, `blurb`, e **por cidade**: `spill_stage_m`, `spill_stage_stops_m`, `normal_stage_cm`, `spill_note` (a UI usa isso no dropdown e na vista do mapa) |
| `hydro.spill_stage_*` / `normal_stage_cm` | Fallback só se a cidade não tiver cota própria |
| `river_thalweg` | LineString `[lon, lat]` do leito principal (sem isso o heatmap não nasce no rio) |
| `river_branches` | Opcional. Outros LineStrings (tributários) com `id`, `name`, `coordinates`, `reach_lags_h`. O flood-fill nasce em todos os leitos, **sem** ligar um rio ao outro. |
| `reach_lags_h` | Um lag por **segmento** do talvegue (`length` ≈ pontos − 1) |
| `gauges.stations[]` | Códigos HidroWeb reais (`code`) |
| `hydro.upstream_city_ids` | Quais cidades entram na média Open-Meteo a montante |
| `hydro.rain_runoff_coeff` / `valley_width_factor` | ΔH = chuva×coeff + Q/factor — **recalibrar**, não copiar o Tijucas |
| `hydro.spill_stage_*` | Cota “sai da calha” da Defesa Civil **daquele** município, não 6 m de SJB |
| `hydro.normal_stage_cm` / `regua_max_m` | Zero da régua (leito) e máximo do slider |
| `hydro.overbank_drain_h` / `rain_storage_halflife_h` | Recuo da mancha e meia-vida do balde de chuva |
| `copy.*` | Textos da UI (dicas, fallback ANA, resumo do vale) |

Arquivos opcionais:

- `regions/<id>.patches.geojson` — correções Δz **já conferidas** daquela bacia (versionadas no git).
- Relatos do mapa: tabela `topo_patch_reports` no Supabase, ou `localStorage` (`valealerta-topo-patches:<id>`) sem banco.

### O que não copiar de outra bacia

- Cota de transbordo **por município** (6 m de SJB não vale para Tijucas-cidade nem para Blumenau).
- Códigos ANA (invente nada: confira no [HidroWeb](https://www.snirh.gov.br/hidroweb)).
- `lag_to_target_h` e `reach_lags_h` (tempos de viagem).
- Coeficientes 0,05 e 250, salvo se um evento real mostrar que servem.
- Talvegue: trace o rio da nova bacia. Tributários entram em `river_branches` (LineString separado), não como um atalho no talvegue principal.

Pacote de exemplo já no repositório: **`regions/itajai.json`** (Vale do Itajaí, alvo Blumenau). Está marcado `provisional` até validação com CEOPS/Defesa Civil e HidroWeb.

## 🛡️ Homologação

Como esta é uma ferramenta de utilidade pública, **nenhuma mancha nova ou mudança da fórmula entra em `main` sem validação**.

* PRs que alteram física da água ou inserem bacia/município pedem revisão (geógrafos, hidrólogos, Defesa Civil).
* Demarcações de relator no app **não** entram em `main` sozinhas: melhoram a simulação local/banco até alguém promover o GeoJSON canônico ou validar in loco.
* A configuração deve ser testada contra um evento real (ex.: Tijucas 2022/2024; Itajaí 2008/2011). Se o slider na cota máxima cobrir a mancha documentada pelo município, o modelo pode ser marcado `calibrated`.

Obrigado por ajudar a democratizar a alfabetização climática e proteger vidas.
