# Resumo Bizurado Digital — PMPE

Página de venda de disparo rápido. Herda paleta, tipografia e assets da landing
`C:\Projetos\pmpe`.

**Fluxo:** clique no CTA → modal com formulário → Lead (PixelX) + Google Sheets →
redireciona para o checkout com os dados já preenchidos.

```
apostila/
├── index.html
├── styles.css
├── script.js
├── exit-popup.css     ← kit portátil, copiado de pmpe/exit-popup-kit/
├── exit-popup.js      ← só o bloco CONFIG foi alterado
├── vercel.json
└── public/            ← apostila.webp, logos, foto do professor, alunos
```

`exit-popup.css` é carregado **antes** de `styles.css`: os ajustes de mobile
(calha de 16px, alvos de toque) sobrescrevem o tema do kit sem editar o kit.

## Assets

Todos em `public/`, reduzidos para o tamanho em que a página realmente os exibe —
a pasta inteira tem ~600 KB. As fotos dos alunos vieram das originais da landing PMPE
(até 2 MB cada) recortadas em 4:5 a 400×500. Ao trocar qualquer imagem, reduza antes:
uma foto de 1 MB numa página de venda custa conversão no 4G.

---

## Tracking

A regra de ouro está em [`C:\Projetos\pmpe\TRACKING.md`](../../pmpe/TRACKING.md):
**deve existir exatamente um emissor de Lead.** Aqui o modo é `LEAD_MODE = "site"`
(Modelo B) — o site dispara, e a barreira de submit em fase de captura corta a
propagação para a regra do painel não duplicar.

Nomenclatura que **não pode ser renomeada** sem antes desligar a regra correspondente
no painel da PixelX:

| Elemento | Atributo | Valor |
|---|---|---|
| `<form>` | `id` | `lead-form` |
| botão de submit | `id` | `IPEyzyfmJhKQEYIXAlZH` |
| telefone | `name` + `class` | `telefone` + `pxa_mask_phone` |

A máscara só aparece se `phone_mask` estiver configurado no painel — o formato vem
de lá, não do HTML. O `name` no input é obrigatório: a função de máscara lê **apenas**
`el.name`, sem cair para o `id`.

## Checkout

`CHECKOUT_BASE` em [script.js](script.js) aponta para o produto. A URL final é montada
em runtime e leva:

- **UTMs e click ids** (`utm_*`, `fbclid`, `gclid`, `ttclid`, `sck`, `src`, `xcod`, `ref`)
  — lidos da URL da visita e guardados em `localStorage`, para quem volta pelo histórico
  não chegar ao checkout como tráfego direto.
- **`_fbp` / `_fbc`** lidos dos cookies do Meta.
- **`external_id` e `sck`** — um UUID por visitante, gerado uma vez e reusado.
- **`name`, `email`, `phone`** do formulário, para o comprador não digitar duas vezes.

Sem nenhum parâmetro na URL, cai no `UTM_FALLBACK` (`utm_source=site`).

> O `ip` que aparece no link de exemplo não é enviado: o navegador não conhece o IP
> público. O checkout resolve isso do lado do servidor.

## Leads na planilha

Vão para a aba `APOSTILA_PMPE` do mesmo Apps Script da landing PMPE
(`SHEET_BASE` em [script.js](script.js)). Crie a aba antes do primeiro disparo.

Falha no envio à planilha **não** bloqueia o redirecionamento — a venda vem primeiro.

## Publicar

```bash
git init && git add . && git commit -m "LP Resumo Bizurado PMPE"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/apostila-pmpe.git
git push -u origin main
```

No Vercel: Add New → Project → importe o repo → Framework Preset **Other** → Deploy.

## Exit popup

Capta para a **comunidade**, não é lead de venda. `stopSubmitPropagation: true`
impede que qualquer regra externa conte este cadastro como `Lead` — misturar quem
quer um grupo grátis com quem quer comprar estraga a otimização das campanhas.

Vai para a aba `APOSTILA_COMUNIDADE` e redireciona para o grupo de WhatsApp.
`blockWhen` impede que ele apareça por cima do modal de compra, e quem chega ao
checkout grava `cppem_apostila_lead_converted` e nunca mais vê o popup.

Para testar no console: `ExitPopup.show()`, `ExitPopup.state()`, `ExitPopup.reset()`.
`state().blocked === true` responde 90% dos "não está aparecendo".

## Mobile

Base de **16px** travada no `html`, com `--gutter: 1rem` no breakpoint de 620px —
toda seção, o rodapé e os dois modais alinham na mesma calha. Campos de formulário
nunca abaixo de 16px: o iOS dá zoom automático em fonte menor e não desfaz sozinho.
Alvos de toque mínimos de 44px.

Verificado a 360px: 14 asserções, sem overflow horizontal.

## Checklist antes do disparo

- [ ] Abas `APOSTILA_PMPE` e `APOSTILA_COMUNIDADE` criadas na planilha
- [ ] Um lead de teste chegou na planilha **e** no Gerenciador de Anúncios
- [ ] `document.querySelectorAll('[id="IPEyzyfmJhKQEYIXAlZH"]').length === 1` no console
- [ ] Checkout abriu com nome, e-mail e telefone preenchidos
- [ ] Preço conferido: R$ 59,90 · 12x R$ 6,12 (página, modal e barra fixa)
- [ ] Popup de saída testado com `ExitPopup.show()` e um cadastro de teste na aba
- [ ] Confirmado no preview do GTM que o cadastro do popup **não** dispara `Lead`
