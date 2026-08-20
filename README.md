# VERTEX GPS

Dashboard local para análise de rotas de trail running e construção de briefings de prova para atleta e treinador.

## Recursos

- Carregamento local de arquivos `.gpx` por seleção ou drag-and-drop.
- Mapa, distância, D+, D−, perfil altimétrico, gradiente, carga e previsão por km.
- Recorte manual de qualquer trecho do percurso e criação de setores do treinador.
- Briefing de prova com perfil do atleta, meta de tempo, experiência técnica, uso de bastões e decisões por setor.
- Projeção orientada ao atleta por ITRA Performance Index, com terreno, clima, experiência técnica, fadiga, altitude e microgradiente do GPX.
- Notas por km e por setor.
- Biblioteca de briefings salva somente no navegador, via IndexedDB. Nenhum GPX ou dado do atleta é enviado para um servidor.

## Executar localmente

Com o ambiente virtual ativado, inicie um servidor na raiz do projeto:

```powershell
python -m http.server 8005
```

Abra `http://localhost:8005` no navegador. Um servidor local é necessário porque o `index.html` carrega componentes HTML em `components/`.

## Privacidade e limites

Os cálculos de rota e os briefings são locais ao dispositivo e navegador. Para compartilhar briefing, criar contas, acompanhar diversos atletas online ou sincronizar dispositivos, será necessária uma etapa futura com backend e autenticação.
