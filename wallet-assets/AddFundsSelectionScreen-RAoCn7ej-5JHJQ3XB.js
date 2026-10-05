import{a as w,b as S,c as T}from"./chunk-WH65W77B.js";import{a as _,b as D}from"./chunk-2HIX4BDG.js";import{a as g,e as n,g as l}from"./chunk-3AFFGVQP.js";import"./chunk-VS37AH2K.js";import{d as Y}from"./chunk-Z4YFJV3J.js";import{L as G,o as E,w as F}from"./chunk-34PAQANK.js";import"./chunk-F66NAYOV.js";import{a as O}from"./chunk-4FV3DXVV.js";import"./chunk-ZEOGAPRR.js";import{n as x,o as L}from"./chunk-IRPIUC7H.js";import"./chunk-TBNMFLSV.js";import"./chunk-LM6RNMSA.js";import"./chunk-PSEHP6ST.js";import"./chunk-H6HKGVGA.js";import{b as k}from"./chunk-3PHIFKGZ.js";import{b as o}from"./chunk-LLZNCNJU.js";import"./chunk-ILKTKST5.js";import"./chunk-OLFJZET5.js";import"./chunk-VZTKKMPI.js";import"./chunk-MKINBOU2.js";import"./chunk-IBO753M2.js";import"./chunk-4IZMZKP2.js";import{Cb as b}from"./chunk-MR6ITS7W.js";import"./chunk-APMUHUV6.js";import{a as I,b as N}from"./chunk-NMJRLO5Z.js";import"./chunk-QCZJZLKO.js";import"./chunk-GP2Z5IJL.js";import"./chunk-5SB6I3OT.js";import"./chunk-ZXC2OJR6.js";import"./chunk-6TZWOWWK.js";import"./chunk-RRRIY5UR.js";import"./chunk-ZLPIN5UY.js";import{f as A}from"./chunk-PLGCP6SF.js";var r=A(N(),1);var t=A(I(),1);var Z={component:()=>{let e=x(),{onUserCloseViaDialogOrKeybindRef:h}=k(),R=b(),i=(0,t.useRef)(!1),m=w(S),P=w(T),[j,B]=(0,t.useState)(!1),u=m?"APPLE_PAY":m===!1&&P?"GOOGLE_PAY":null,f=m===!0||m===!1&&P!==void 0,y=!e?.startFiat||f||j;(0,t.useEffect)((()=>{let C=window.setTimeout((()=>B(!0)),2e3);return()=>window.clearTimeout(C)}),[]),(0,t.useEffect)((()=>{e&&(i.current=!1)}),[e]);let v=(0,t.useRef)(null);(0,t.useEffect)((()=>{e&&!e.error&&y&&v.current!==e&&(v.current=e,e.recordRowsViewed?.({walletPay:e.startFiat?u:void 0,walletPayTimedOut:e.startFiat?!f:void 0}))}),[y,e,u,f]);let a=(0,t.useCallback)((async()=>{!i.current&&e&&(i.current=!0,L(),await e.onCancel())}),[e]);if((0,t.useEffect)((()=>(h.current=a,()=>{h.current===a&&(h.current=null)})),[a,h]),!e)return null;if(e.error)return(0,r.jsx)(g,{title:"Unable to add funds",subtitle:e.error,showClose:!0,onClose:a,primaryCta:{label:"Close",onClick:a}});let p=async C=>{i.current||(i.current=!0,await e.startFiat?.(C))};return(0,r.jsx)(g,{title:"Pay with",subtitle:"Debit cards typically have higher success rates than credit cards, even with Apple Pay or Google Pay.",showClose:!0,onClose:a,children:y?(0,r.jsxs)(Y,{style:{marginTop:"1rem"},$colorScheme:R.appearance.palette.colorScheme,children:[e.startFiat&&(0,r.jsxs)(l,{onClick:()=>p("CREDIT_DEBIT_CARD"),children:[(0,r.jsx)(s,{children:(0,r.jsx)(E,{})}),(0,r.jsxs)(c,{children:[(0,r.jsx)(n,{children:"Debit or credit card"}),(0,r.jsx)(d,{children:"Less than 10 minutes"})]})]}),e.startFiat&&u==="APPLE_PAY"&&(0,r.jsxs)(l,{onClick:()=>p("APPLE_PAY"),children:[(0,r.jsx)(s,{children:(0,r.jsx)(_,{width:18,height:18})}),(0,r.jsxs)(c,{children:[(0,r.jsx)(n,{children:"Apple Pay"}),(0,r.jsx)(d,{children:"Less than 10 minutes"})]})]}),e.startFiat&&u==="GOOGLE_PAY"&&(0,r.jsxs)(l,{onClick:()=>p("GOOGLE_PAY"),children:[(0,r.jsx)(s,{children:(0,r.jsx)(D,{width:18,height:18})}),(0,r.jsxs)(c,{children:[(0,r.jsx)(n,{children:"Google Pay"}),(0,r.jsx)(d,{children:"Less than 10 minutes"})]})]}),e.startFiat&&(0,r.jsxs)(l,{onClick:()=>p("BANK"),children:[(0,r.jsx)(s,{children:(0,r.jsx)(F,{})}),(0,r.jsxs)(c,{children:[(0,r.jsx)(n,{children:"Bank account"}),(0,r.jsx)(d,{children:"1\u20132 days"})]})]}),e.startCrypto&&(0,r.jsxs)(l,{onClick:async()=>{i.current||(i.current=!0,await e.startCrypto?.())},children:[(0,r.jsx)(s,{children:(0,r.jsx)(G,{})}),(0,r.jsxs)(c,{children:[(0,r.jsx)(n,{children:"Crypto wallet or exchange"}),(0,r.jsx)(d,{children:"Instant"})]})]})]}):(0,r.jsx)(z,{children:(0,r.jsx)(O,{size:"50px"})})})}},z=o.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 1rem;
  min-height: 8rem;
`,s=o.span`
  width: 2rem;
  height: 2rem;
  border-radius: var(--privy-border-radius-full);
  background-color: var(--privy-color-background-2);
  color: var(--privy-color-icon-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;

  svg {
    width: 1.125rem;
    height: 1.125rem;
  }
`,c=o.span`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
`,d=o.span`
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: var(--privy-color-foreground-3);
`;export{Z as AddFundsSelectionScreen,Z as default};
