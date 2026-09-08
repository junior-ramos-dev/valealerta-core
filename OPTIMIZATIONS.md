# Otimizações e limites do relevo

Este documento registra **margens de erro** do heatmap de inundação e caminhos para reduzir a “inacurácia” quando o chão mudou depois do modelo de altitude (aterro, corte, dique, loteamento).

O simulador **não vê a foto de satélite** da Esri. Ele calcula água − terreno usando o **Copernicus DEM GLO-30** (~30 m, datum aproximado EGM96). Se o DEM estiver desatualizado, a mancha segue o modelo antigo, não a rua de hoje.

---

## Por que a mancha pode “errar” num aterro recente

Exemplo real no vale: entorno de **27.26440° S, 48.82210° O** (planície em Canelinha / beira do Tijucas), com **aterro da ordem de +2 m**.

Na imagem, o platô é alto e o lote vizinho é mais baixo. No GLO-30:

* o pixel do aterro **continua baixo** (a obra não entrou no catálogo);
* o vizinho sem aterro, mas com **casa ou árvore**, pode aparecer **mais alto** (o GLO-30 é um modelo de *superfície*, DSM: telhado e copa entram na altitude).

A água sobe pelas células **mais baixas no DEM**. Resultado típico: o heatmap pinta o aterro (ainda “fundo de vale” no modelo) **antes** do entorno que, na vida real, é o primeiro a alagar.

Outras fontes de erro, mesmo sem obra nova:

| Fator | Ordem de grandeza | Efeito no mapa |
| --- | --- | --- |
| Resolução GLO-30 | ~30 m no chão | um lote, um bueiro ou um platô estreito viram **um pixel médio** |
| Acurácia vertical do DEM | frequentemente **2–4 m** em área urbana | a régua e o “sai da calha” não batem centímetro a centímetro com o GNSS |
| Data do DEM | revisão em **anos**, não em dias | aterro, corte e defesa ribeirinha somem do modelo |
| DSM vs DTM | metros em mata/edificação | “morro” de telhado ao lado de pátio baixo |
| Superfície d’água simplificada | cota única na vista + folga ~0,5 m para ruído | não substitui um levantamento local |

Isso **não é bug da régua**: é o limite de usar um relevo global gratuito no navegador. A folga de conectividade (~0,55 m) só ajuda a atravessar um pico fino de ruído; **não inventa** os 2 m do aterro.

---

## O que *não* resolve (e por quê)

Não existe DEM mundial **gratuito, diário e de 1 m**.

* **Atualizar o Copernicus “todo dia”** — o produto não opera nessa cadência.
* **Ler altitude na foto Esri** — a imagem mostra que o chão mudou; **não** dá os 2 m.
* **Sentinel-1 SAR diário como DEM de lote** — enxerga água sob nuvem e, às vezes, obra grande; **não** entrega +2 m por terreno todo dia.
* **Reconstruir 1 m só com foto comercial** — caro, instável e perigoso num alerta (altitude inventada é pior que “não sei”).

“Diário” no Vale Alerta deve significar: **dar para publicar uma correção no mesmo dia da obra**, não voar o planeta de manhã.

---

## Como contornar: base estável + correções locais

Manter o GLO-30 e somar um **delta** só onde a terra mudou:

```text
z_usado = z_Copernicus + Δz_local
```

Para o aterro do exemplo, `Δz_local ≈ +2 m` no polígono do lote. O flood-fill passa a ver o platô alto e enche **primeiro o entorno baixo**.

Cadência útil: **quando a obra termina** (ou quando a Defesa Civil avisa), não um cron que “refaz o vale” às 6h.

### 1. Patch imediato (chute explícito)

* Polígono no mapa ou GeoJSON: *este lote = +2,0 m*, data, fonte (“morador”, “prefeitura”).
* Vertical típica: **±0,5–1 m** se for olho + foto.
* Encaixa na ideia dos **pins comunitários** (PostGIS / `hazard_pins`): “aterro +2 m aqui”, *provisório* até validação.

Mínimo que já melhoraria o ponto 27.26440° S, 48.82210° O.

### 2. Medição (quando existir)

| Fonte | Vertical | Quando faz sentido |
| --- | --- | --- |
| GNSS / nível da prefeitura | centímetros | lote, rua, dique |
| Drone (fotogrametria) | ~10–30 cm | bairro depois de enchente ou obra |
| LiDAR municipal | ~5–15 cm | “verdade” da calha e terraços |

O GeoTIFF local **substitui ou soma** no recorte; o resto da bacia continua GLO-30.

### 3. Satélite como *detecção de mudança*, não como relevo

* **Sentinel-2 / imagens óticas:** “aqui nasceu um platô” → alguém mede ou desenha o polígono.
* **Sentinel-1:** mancha de água real sob tempestade, para **validar** o heatmap, não para esculpir o aterro.

### 4. Encaixe no repositório (implementado no dashboard)

1. GeoJSON canônico: `backend-satellite/topo_patches/patches.geojson` (servido em `/topo_patches.geojson`).
2. No mapa: **Demarcar área** → cliques nos vértices → informar **Δz** (ex. +2 m de aterro, não a cota absoluta) → **Aplicar Δz**.
3. O cliente soma o delta na malha Copernicus (`copernicusDem.ts`) antes do hillshade e do flood-fill.
4. Correções deste browser ficam no `localStorage`; **Baixar GeoJSON** para versionar no repositório.
5. Pins verificados no PostGIS continuam o passo seguinte (ainda não ligados).

Ponto natural de configuração: `backend-satellite/config.json` (lista de patches) e/ou `backend-database/migrations.sql` (geometria versionada).

---

## Prioridade sugerida

1. **Documentar o limite na UI** (já há aviso no cartão do ponteiro: aterro recente pode não estar no relevo).
2. **Patches poligonais +Δz** para obras conhecidas (maior ganho / menor custo).
3. **LiDAR ou drone** nos trechos críticos (SJB, Canelinha, terraços aterrados).
4. **Sentinel-1** para confrontar mancha real × mancha simulada, não para DEM diário.

Enquanto não houver patch, o modelo permanece honesto **com o satélite antigo** e visivelmente defasado **com a rua de hoje**. Isso deve ser dito ao cidadão: paz de espírito inclui saber **o que o mapa não sabe**.
