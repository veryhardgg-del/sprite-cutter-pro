# Sprite Cutter Pro

Sprite Cutter Pro é uma ferramenta gratuita para recortar spritesheets automaticamente e exportar cada sprite em PNG transparente.

O projeto foi criado para ajudar spriters, criadores de servidores de Ragnarok Online, pixel artists, modders, usuários de RPG Maker e desenvolvedores de jogos 2D.

## Recursos

- Upload de spritesheets em PNG, JPG, JPEG e WEBP
- Detecção automática de sprites
- Melhor detecção em spritesheets com fundo rosa, azul ou outras cores chapadas
- Remoção automática de fundo
- Seleção manual da cor de fundo
- Ajuste de tolerância de cor
- Correção manual das caixas de recorte
- Visualizador com zoom
- Opção para ignorar textos pequenos
- Opção para ignorar retratos grandes
- Opção para separar efeitos grandes
- Preview de cada sprite detectada
- Download individual em PNG transparente
- Exportação em ZIP
- Exportação de metadata em JSON
- Modo pixel art sem suavização
- Presets para:
  - Ragnarok Online
  - Nintendo DS/GBA
  - RPG Maker
  - Pixel Art genérico
- Interface em PT-BR e EN
- Funciona no navegador

## Privacidade

O processamento é 100% local.

As imagens não são enviadas para nenhum servidor. Todo o recorte acontece diretamente no navegador do usuário usando HTML Canvas.

## Como usar

1. Clique em **Upload** e envie uma spritesheet.
2. O app tentará detectar as sprites automaticamente.
3. Se o fundo não for detectado corretamente, clique em **Selecionar fundo** e depois clique em uma área vazia da imagem.
4. Ajuste os controles de tolerância, padding, área mínima e junção de partes próximas se necessário.
5. Use o zoom para conferir detalhes e ajustar caixas manualmente.
6. Confira as sprites geradas na lista lateral.
7. Clique em **Exportar ZIP** para baixar todas as sprites em PNG transparente.

> Em spritesheets muito complexas, com efeitos grandes, textos ou muitos tamanhos diferentes, talvez seja necessário ajustar os presets ou corrigir alguns recortes manualmente.

## Instalação local para desenvolvimento

```bash
npm install
npm run dev
```

## Gerar versão de produção

```bash
npm run build
```

## Tecnologias

- React
- TypeScript
- Vite
- HTML Canvas
- JSZip
- FileSaver

## Contribuições

Sugestões, melhorias e correções são bem-vindas.

Abra uma issue ou envie um pull request pelo GitHub.

## Créditos

Criado por **VeryHardgg** com apoio do **ChatGPT** para ajudar spriters, criadores de servidores de Ragnarok Online, pixel artists e desenvolvedores de jogos 2D.

## Licença

Este projeto está disponível sob a licença MIT.
