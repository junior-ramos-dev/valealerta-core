# 🤝 Como Contribuir para o Vale Alerta

Seja bem-vindo ao projeto **Vale Alerta**! Este é um ecossistema construído por cidadãos e especialistas para proteger comunidades contra eventos climáticos extremos. Para manter a ferramenta confiável e escalável, seguimos um processo estruturado de revisão por pares.

## 🌍 Como Adicionar uma Nova Cidade ou Região do Vale

Não é necessário mexer nos códigos de interface (React) para expandir o mapa para a sua cidade. Siga os passos:

1. Faça um **Fork** deste repositório.
2. Abra o arquivo `backend-satellite/config.json`.
3. Adicione o bloco da sua cidade no array seguindo o modelo, preenchendo:
   - `center` (Coordenadas centrais de visualização)
   - `base_elevation_meters` (A cota altimétrica média do chão do vale urbano)
   - `rain_intensity_multiplier` (Fator de escoamento/resposta do leito)
4. Abra um **Pull Request (PR)** detalhando qual município você está adicionando.

## 🛡️ O Processo de Homologação Técnica e Validação

Como esta é uma ferramenta de utilidade pública que auxilia na tomada de decisões em momentos de emergência, **nenhuma nova mancha de inundação ou alteração matemática de hidrologia será mesclada diretamente na branch principal sem validação**.

* **Revisão por Especialistas:** Todos os PRs que alteram o comportamento físico da água ou inserem novos municípios serão automaticamente marcados para revisão por nossa banca voluntária de especialistas (Geógrafos, Engenheiros Hidrólogos e Membros de Defesa Civil).
* **Validação por Benchmarks Históricos:** Para ser aprovada, a configuração inserida deve ser testada contra um evento real conhecido na sua região (Ex: *A grande cheia de 2022 ou 2024*). Se o slider na cota máxima cobrir a mancha real documentada pelo município, o modelo é considerado calibrado e pronto para o merge.

Obrigado por ajudar a democratizar a alfabetização climática e proteger vidas!
