# Otimizações e limites do relevo

Este documento registra **margens de erro** do heatmap de inundação e caminhos para reduzir a “inacurácia” quando o chão mudou depois do modelo de altitude (aterro, corte, dique, loteamento).

O simulador **não vê a foto de satélite** da Esri. Ele calcula água − terreno usando o **Copernicus DEM GLO-30** (~30 m, datum aproximado EGM96). Se o DEM estiver desatualizado, a mancha segue o modelo antigo, não a rua de hoje.

---

## Por que a mancha pode “errar” num aterro recente

Exemplo real no vale: entorno de **27.26440° S, 48.82210° O** (planície em Canelinha / beira do Tijucas), com **aterro da ordem de +2 m**.

Na imagem, o platô é alto e o lote vizinho é mais baixo. No GLO-30:

* o pixel do aterro **continua baixo** (a obra não entrou no catálogo);
* o vizinho sem aterro, mas com **casa ou árvore**, pode aparecer **mais alto** (o GLO-30 é um modelo de *superfície*, DSM: telhado e copa entram na altitude).

A água sobe pelas células **mais baixas no DEM**. Sem correção, o heatmap pinta o aterro (ainda “fundo de vale” no modelo) **antes** do entorno que, na vida real, é o primeiro a alagar.

A demarcação de relevo no app **não torna o GLO-30 um levantamento**. Ela só diz: “neste polígono, some Δz ao satélite antigo”. Isso ameniza o atraso do catálogo **quando a obra é maior que o ruído vertical** (2–4 m). Um Δz de 0,3 m some no DSM; +2 m de platô, não.

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

“Diário” no Vale Alerta SC deve significar: **dar para publicar uma correção no mesmo dia da obra**, não voar o planeta de manhã.

---

## Como contornar: base estável + correções locais

Manter o GLO-30 e somar um **delta** só onde a terra mudou:

```text
z_usado = z_Copernicus + Δz_local
```

Para o aterro do exemplo, `Δz_local ≈ +2 m` no polígono do lote. O flood-fill passa a ver o platô alto e enche **primeiro o entorno baixo**.

O que a marcação **melhora** na validade dos dados:

| Limite do GLO-30 | O que o polígono faz | O que ele não faz |
| --- | --- | --- |
| Catálogo atrasado (anos) | Recoloca a obra no modelo **no mesmo dia** | Não atualiza o satélite; é um adendo |
| Pixel de 30 m | Aplica Δz em todas as células cujo **centro** cai no polígono | Não desenha o meio-fio nem o talude real |
| Erro vertical 2–4 m | Ajuda se o Δz for **claro** (aterro de metros). Vários relatores: média de Δz (1 voto por pessoa); amplitude ≥ 1 m pinta o sítio de vermelho | Não vira GNSS. Olho + foto: típico ±0,5–1 m |
| DSM (telhado/copa) | Nada | Casa ao lado do pátio continua “alta” no DEM |
| Aterro no leito | O **talvegue** (cota d’água) usa o GLO-30 **cru**; o Δz não sobe o rio | Se o polígono for pequeno diante da mancha, o volume deslocado quase não se vê |
| DEM futuro já “comeu” a obra | Compara a cota atual com a gravada na criação; **absorvido** deixa de somar Δz (evita contar duas vezes) | Absorção usa a mesma malha ruidosa: em dúvida, “somar mesmo assim” |

Cadência útil: **quando a obra termina** (ou quando a Defesa Civil avisa), não um cron que “refaz o vale” às 6h. **Validação in loco** (papel validador no banco) é o que transforma chute de relator em dado conferido — o app só agrupa sobreposições e denuncia divergência de altura.

### 1. Patch imediato (chute explícito)

* Polígono no mapa: *este lote = +2,0 m*, nome, relator, data.
* Vertical típica sem instrumento: **±0,5–1 m** (olho + foto).
* Vários moradores no mesmo sítio: o modelo usa a **média de Δz**, não a soma, e ignora diferença pequena de área.

Isso já melhoraria o ponto 27.26440° S, 48.82210° O, desde que o Δz seja da ordem dos 2 m — não um “ajuste fino” abaixo do ruído do DEM.

### 2. Medição (quando existir)

| Fonte | Vertical | Quando faz sentido |
| --- | --- | --- |
| GNSS / nível da prefeitura | centímetros | lote, rua, dique |
| Drone (fotogrametria) | ~10–30 cm | bairro depois de enchente ou obra |
| LiDAR municipal | ~5–15 cm | “verdade” da calha e terraços |

O GeoTIFF local **substitui ou soma** no recorte; o resto da bacia continua GLO-30. A demarcação no app é o paliativo até existir essa malha.

### 3. Satélite como *detecção de mudança*, não como relevo

* **Sentinel-2 / imagens óticas:** “aqui nasceu um platô” → alguém mede ou desenha o polígono.
* **Sentinel-1:** mancha de água real sob tempestade, para **validar** o heatmap, não para esculpir o aterro.

### 4. O que o dashboard já faz

1. Aba **Ferramentas** (login/cadastro obrigatório para corrigir). **Demarcar área** (conta relator): vértices no mapa, Δz relativo, fechar no primeiro ponto / Enter. Área em m² na barra.
2. **Simular inundação com correções** (depois do login): soma o Δz no hillshade e no heatmap mesmo sem validação institucional. Desligado = GLO-30 puro. Não é parecer da Defesa Civil. Sem conta, a aba só mostra o formulário; a régua fica em **Simulação**.
3. Cliente: `z_usado` em `copernicusDem.ts` **antes** do hillshade e do flood-fill. Talvegue em `inundation.ts` no DEM **cru**. Volume que não cabe mais no platô **sobe a lâmina no entorno**.
4. **Minhas / todas as marcações:** consenso por sobreposição (IoU). Pacote versionado: `regions/<id>.patches.geojson`. Com Supabase: tabela `topo_patch_reports` (GeoJSON + Δz + usuário) assim que aplica. Sem banco: `localStorage`. **Baixar GeoJSON** é só cópia de segurança.
5. **Absorção** quando o GLO-30 já refletiu a obra. Validador/admin: **validar in loco**.
6. Pins de foto (`hazard_pins`) continuam **outro** fluxo (ainda não no mapa) — não confundir com o polígono de Δz.

O caminho antigo `backend-satellite/topo_patches/patches.geojson` foi substituído pelos pacotes em `regions/` e, em produção, pelo banco.

---

## Prioridade sugerida

1. **Documentar o limite na UI** (sonda, HUD da simulação hipotética, nota de absorção).
2. **Patches poligonais + Δz** nas obras conhecidas — maior ganho / menor custo, **se** o delta for maior que o ruído do DEM; vários relatos + in loco melhoram a confiança no número, não na malha de 30 m.
3. **LiDAR ou drone** nos trechos críticos (SJB, Canelinha, terraços aterrados).
4. **Sentinel-1** para confrontar mancha real × mancha simulada, não para DEM diário.

Sem patch, o modelo permanece honesto **com o satélite antigo** e visivelmente defasado **com a rua de hoje**. Com patch, ele é honesto **com o satélite mais o que alguém mediu ou chutou no polígono**. Paz de espírito inclui saber **o que o mapa não sabe**.
