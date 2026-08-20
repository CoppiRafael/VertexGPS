# Modelo VERTEX de projeção por ITRA PI

Este documento descreve a projeção implementada no navegador. Ela não reproduz nem tenta inferir algoritmos proprietários de terceiros, ITRA ou UTMB.

## Entradas

- ITRA Performance Index (1–1000), informado pelo atleta;
- leitura por faixa feminina ou masculina;
- experiência técnica do atleta;
- GPX: distância, altitude e microgradiente entre pontos suavizados;
- terreno declarado: estradão/corrível, trail misto, técnico ou neve/lama;
- condição climática declarada.
- opcionalmente, melhores tempos recentes de 5 km e/ou 10 km no plano.

O ITRA PI é oficial; o tempo previsto é uma calibração VERTEX. A ITRA calcula o seu próprio Race Score a partir de características mensuráveis e de uma correção estatística de terreno/condições baseada na sua base de resultados. Não existe uma conversão pública e oficial de PI para tempo em qualquer GPX.

## Cálculo

Para cada segmento consecutivo do GPX, o VERTEX calcula:

1. custo energético relativo de inclinação pela curva de Minetti;
2. equivalente vertical: `km + D+/100`; a descida fica principalmente na curva de custo de inclinação e só recebe componente extra de impacto para quem declarou pouca experiência técnica;
3. o maior entre custo de inclinação e equivalente vertical;
4. multiplicadores de mudança de gradiente, altitude média acima de 1500 m, terreno, clima, corribilidade declarada e fadiga acumulada;
5. fadiga proporcional ao volume da prova, para não penalizar uma prova curta como uma ultra;
6. soma dos microtrechos em cada quilômetro, para distribuir os splits; atletas experientes ou competitivos recebem uma redistribuição para trechos corríveis no início e no fim, sem inventar um sprint em subida técnica.

Antes da projeção, o VERTEX consolida um único perfil técnico da rota. Esse perfil é compartilhado conceitualmente com as telas de Altimetria, Gradiente, Carga e Insights e contém distância, D+/D−, altitude média e exposição acima de 1500/2000 m, proporção corrível, exposição a gradientes extremos, volatilidade por km, maior subida/descida sustentada, carga média/P90/máxima, concentração da carga e tecnicidade estrutural. O engine usa esse perfil para modular corribilidade, dificuldade e fadiga; a interface permite abrir “Entradas consolidadas do engine” para auditar os valores.

Cada quilômetro recebe ainda uma dificuldade estrutural de 0 a 100, classificada como baixa, moderada, alta, muito alta ou extrema. A leitura combina carga relativa, volatilidade, maior inclinação local, componente vertical e tecnicidade geral. A dificuldade aumenta o custo de trechos críticos de maneira dependente da experiência técnica: o efeito é maior para iniciantes e pequeno para especialistas.

A saída principal é uma faixa provável, não um horário exato. O centro matemático continua disponível para distribuir os ritmos, e cada quilômetro mostra sua própria faixa, ampliada discretamente nos trechos de maior dificuldade.

O tempo total é `km-equivalentes-ajustados / velocidade-base`, onde a velocidade-base é uma curva VERTEX suave derivada do PI. A curva é propositalmente explícita no código para que possa ser recalibrada com dados reais, sem se apresentar como fórmula ITRA.

## Ajuste opcional por 5 km e 10 km

Os tempos de rua são convertidos para a distância equivalente da rota por uma curva de resistência do tipo Riegel. Quando os dois tempos existem, o expoente individual é estimado pela relação entre 5 km e 10 km; valores fora de uma faixa plausível têm influência reduzida.

O resultado de rua não substitui nem altera a velocidade-base derivada do ITRA. Ele atua somente como ajuste fino nos splits corríveis do início e do final, depois da experiência, do gradiente e do terreno. A sensibilidade é limitada pelo tipo de terreno, pela corribilidade e pelo tamanho da prova, e a correção em cada split fica limitada a ±2,5%. Um único tempo de 5 km recebe influência ainda menor.

## Faixas de nível na interface

As etiquetas são faixas operacionais VERTEX. A ITRA afirma que a leitura de nível depende de gênero e categoria, e publica como referência que elite masculina está acima de 825 e feminina acima de 700. A etiqueta não substitui a tabela oficial completa nem uma avaliação do treinador.

## Calibração responsável

Antes de chamar o resultado de "validado", registrar provas com GPX real, índice vigente na data da largada, terreno/clima, tempo bruto e paradas. Separar treino e teste por prova/atleta; medir erro absoluto mediano e por nível/terreno; publicar versão, amostra e intervalo de incerteza do modelo.

## Integração oficial futura

Esta aplicação é local e não deve fazer scraping de perfis. Para preencher o índice automaticamente é necessário um serviço de backend e uma API, parceria ou autorização explícita da fonte. Armazenar a origem, a data de consulta, a categoria do índice e consentimento do atleta; oferecer sempre edição manual e exclusão.
