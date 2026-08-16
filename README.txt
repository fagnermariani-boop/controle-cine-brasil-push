CONTROLE CINE BRASIL - PUSH REAL NO CLOUDFLARE

Este pacote mantem o site original e acrescenta notificacoes push para:
- solicitacao aprovada ou nao autorizada;
- encomenda ou correspondencia registrada pelo zelador.

O aviso chega ao Android mesmo com o aplicativo fechado.

PUBLICACAO (CLOUDFLARE SHELL)

1. Entre nesta pasta e instale os componentes:
   npm install

2. Crie o banco das inscricoes push:
   npx wrangler d1 create cine-brasil-push

3. O comando mostrara um database_id. Abra wrangler.jsonc e substitua:
   COLE_AQUI_O_ID_DO_BANCO_D1

4. Crie a tabela no banco:
   npx wrangler d1 execute cine-brasil-push --remote --file=schema.sql

5. Gere as chaves VAPID uma unica vez:
   npx web-push generate-vapid-keys

6. Cadastre os tres valores como segredos. Em cada comando, cole o valor pedido:
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_SUBJECT

   Para VAPID_SUBJECT, use:
   mailto:administracao@cinebrasil.local

7. Publique:
   npx wrangler deploy

ATIVACAO NO CELULAR DO MORADOR

1. Abra o endereco Cloudflare e entre como morador.
2. Toque no sino de notificacoes.
3. Selecione Permitir.
4. O dispositivo sera associado ao bloco e apartamento usados no acesso.

IMPORTANTE

- Morador e zelador devem usar o endereco do Cloudflare.
- Se as notificacoes estiverem bloqueadas, libere-as nas configuracoes.
- Uma mesma unidade pode cadastrar mais de um celular.
- As chaves privadas permanecem protegidas nos segredos do Cloudflare.
