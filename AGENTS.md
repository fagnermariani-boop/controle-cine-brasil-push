# Projeto — Aplicativo Condomínio Cine Brasil

## Contexto
Aplicativo para moradores e administração do Condomínio Cine Brasil,
com reservas, acessos, encomendas e comunicações.

Repositório:
https://github.com/fagnermariani-boop/controle-cine-brasil-push

Branch de trabalho: main.

## Estrutura
- worker.js: Cloudflare Worker, proxy, integrações e personalizações.
- wrangler.jsonc: configuração de publicação e banco D1.
- schema.sql: estrutura do banco.
- logo-cinebrasil.png: logotipo oficial do condomínio.

O Worker utiliza como origem:
https://controle-cine-brasil.redecondoclub.chatgpt.site

Parte da interface é carregada dessa origem. As personalizações locais
utilizam HTMLRewriter, CSS e scripts injetados pelo Worker.
Não presumir que os componentes da origem existem neste repositório.

## Forma de trabalho
- Ler o código atual antes de alterar.
- Fazer mudanças pontuais, preservando funcionalidades existentes.
- Não executar build separado.
- Evitar verificações desnecessárias.
- Quando solicitado pelo usuário, fornecer comandos completos para
  colar no terminal do Codespaces.
- Nos scripts de edição, verificar se o trecho esperado existe antes
  de salvar e evitar duplicar alterações já aplicadas.
- Não substituir o worker.js inteiro por uma versão antiga.
- Informar claramente se a alteração foi executada ou se depende
  de o usuário executar os comandos.

## Publicação
Fluxo utilizado neste projeto:

git add <arquivos alterados>
git commit -m "Descrição objetiva da alteração"
git push origin main
npx wrangler deploy

A publicação pelo Wrangler é diretamente em produção.
Executar publicação somente quando autorizada no contexto da tarefa.
Não alterar configurações, bindings ou credenciais sem necessidade.

## Identidade visual
- Cores principais: azul-marinho e dourado.
- Azul principal utilizado: #001b50.
- Dourado utilizado nos ícones: #b88a36.
- Fundo claro dos ícones: #fff5de.
- Preservar o logotipo original, suas proporções e cores.
- Usar logo-cinebrasil.png na abertura e na tela de acesso.
- No cabeçalho interno, usar o logotipo pequeno no lugar de “CB”.
- Priorizar apresentação e uso no celular.

## Página inicial do morador
Título aprovado:
“Controle de Reservas, Acessos, Encomendas e Comunicações”

Botões:
1. Reserva do Salão de Festas.
2. Mudança e Transporte de Móveis.
3. Comunicação de Barulho Pontual.
4. Encomendas e Correspondências.
5. Gerar Token de Emergência.
6. Vídeo Porteiro.

Manter:
- Grade compacta de duas colunas no celular.
- Ícones em azul e dourado, centralizados acima dos nomes.
- Caminhão para mudança e transporte de móveis.
- Chave horizontal com cabeça quadrada arredondada para token.
- Ícones e textos com boa legibilidade.
- Navegação inferior e recursos existentes.

## Token de Emergência
- Página interna seguindo o padrão visual do aplicativo.
- Gerar código de seis números, preservando zeros iniciais.
- Informar validade de cinco minutos.
- Explicar brevemente o uso em caso de esquecimento da TAG.
- A versão atual é demonstrativa, com números aleatórios.
- Não apresentar o código como integrado a uma fechadura real.
- Uma integração futura exige validação e expiração no servidor.

## Vídeo Porteiro
Descrição:
“Veja quem está tocando o interfone no portão.”

Seletores acima do player:
- Portão Bento 1.
- Portão Bento 2.
- Portão Blumenau.

A demonstração utiliza transmissões públicas do Live World Webcams.
Preservar as fontes e a configuração que estiverem funcionando.
Essas transmissões não são as câmeras reais do condomínio.

## Funcionalidades que devem ser preservadas
- Acesso e sessão do morador.
- Reservas e suas regras de aceite.
- Solicitações e comunicações.
- Encomendas e correspondências.
- Área administrativa.
- Notificações push.
- Instalação PWA, manifestos e service worker.
- Créditos e apresentação da Rede CondoClub.

## Cuidados técnicos
- Scripts que observam mudanças no DOM devem ser idempotentes.
- Evitar ciclos de MutationObserver.
- Considerar a navegação dinâmica ao aplicar personalizações.
- Limitar alterações visuais à página e ao perfil solicitados.
- Não expor tokens, chaves privadas ou segredos no código cliente.
- Nunca incluir credenciais em commits.
