# Vale Alerta SC

## Simulador de enchentes/inundação causados por alto volumes de chuva. 

### Pacotes atuais: **Vale do Rio Tijucas** e **Vale do Itajaí** (com dados provisórios). 

* **Novas bacias: `regions/` e `CONTRIBUTING.md`**.

* **A documentação completa do produto, das fontes de dados e do setup local está em [frontend-dashboard/README.md](frontend-dashboard/README.md)**. 

* **Limites do Copernicus DEM e correções Δz: [OPTIMIZATIONS.md](OPTIMIZATIONS.md)**. 

* **Como contribuir com o projeto ou adicionar novas regiões: [CONTRIBUTING.md](CONTRIBUTING.md)**.

* **PWA (instalação em computador ou celular, uso online/offline): [PWA.md](PWA.md)**.

* **Deploy (Supabase + EC2/Caddy, testes e troubleshooting): [DEPLOY.md](DEPLOY.md)**.

* **Contas, papéis e demarcações de relevo:** projeto Supabase + `backend-database/migrations.sql`; o dashboard lê e grava polígonos na tabela assim que o relator aplica o Δz (ver [frontend-dashboard/README.md](frontend-dashboard/README.md)).
