# 🤝 Como Contribuir para o Vale Alerta

Seja bem-vindo ao projeto **Vale Alerta**. O motor (Copernicus DEM, Open-Meteo, flood-fill, régua, patches) é genérico. Cada bacia é um **pacote de região** em JSON — não é preciso alterar React para incluir um vale novo, desde que o JSON esteja completo e calibrado.

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
| `river_thalweg` | LineString `[lon, lat]` do leito (sem isso o heatmap não nasce no rio) |
| `reach_lags_h` | Um lag por **segmento** do talvegue (`length` ≈ pontos − 1) |
| `gauges.stations[]` | Códigos HidroWeb reais (`code`) |
| `hydro.upstream_city_ids` | Quais cidades entram na média Open-Meteo a montante |
| `hydro.rain_runoff_coeff` / `valley_width_factor` | ΔH = chuva×coeff + Q/factor — **recalibrar**, não copiar o Tijucas |
| `hydro.spill_stage_*` | Cota “sai da calha” da Defesa Civil **daquele** município, não 6 m de SJB |
| `hydro.normal_stage_cm` / `regua_max_m` | Zero da régua (leito) e máximo do slider |
| `hydro.overbank_drain_h` / `rain_storage_halflife_h` | Recuo da mancha e meia-vida do balde de chuva |
| `copy.*` | Textos da UI (dicas, fallback ANA, resumo do vale) |

Arquivos opcionais:

- `regions/<id>.patches.geojson` — correções Δz canônicas (aterros) daquela bacia.
- Patches desenhados no browser ficam em `localStorage` **por região** (`valealerta-topo-patches:<id>`).

### O que não copiar de outra bacia

- Cota de transbordo **por município** (6 m de SJB não vale para Tijucas-cidade nem para Blumenau).
- Códigos ANA (invente nada: confira no [HidroWeb](https://www.snirh.gov.br/hidroweb)).
- `lag_to_target_h` e `reach_lags_h` (tempos de viagem).
- Coeficientes 0,05 e 250, salvo se um evento real mostrar que servem.
- Talvegue: trace o rio da nova bacia (e tributários só se forem outro LineString no futuro).

Pacote de exemplo já no repositório: **`regions/itajai.json`** (Vale do Itajaí, alvo Blumenau). Está marcado `provisional` até validação com CEOPS/Defesa Civil e HidroWeb.

## 🛡️ Homologação

Como esta é uma ferramenta de utilidade pública, **nenhuma mancha nova ou mudança da fórmula entra em `main` sem validação**.

* PRs que alteram física da água ou inserem bacia/município pedem revisão (geógrafos, hidrólogos, Defesa Civil).
* A configuração deve ser testada contra um evento real (ex.: Tijucas 2022/2024; Itajaí 2008/2011). Se o slider na cota máxima cobrir a mancha documentada pelo município, o modelo pode ser marcado `calibrated`.

Obrigado por ajudar a democratizar a alfabetização climática e proteger vidas.
