const GREETINGS: { text: string; font: string }[] = [
  { text: "வணக்கம்", font: "wm-tamil" },
  { text: "नमस्ते", font: "wm-deva" },
  { text: "Hello", font: "" },
  { text: "நன்றி", font: "wm-tamil" },
  { text: "धन्यवाद", font: "wm-deva" },
  { text: "Thank you", font: "" },
  { text: "எப்படி இருக்கிறீர்கள்?", font: "wm-tamil" },
  { text: "आप कैसे हैं?", font: "wm-deva" },
  { text: "How are you?", font: "" },
  { text: "மீண்டும் சந்திப்போம்", font: "wm-tamil" },
  { text: "फिर मिलेंगे", font: "wm-deva" },
  { text: "See you soon", font: "" },
];

export function Star({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12 0l2.4 7.1L22 5.6l-4.7 5.9L24 14l-7.3 1.2L18 23l-6-4.6L6 23l1.3-7.8L0 14l6.7-2.5L2 5.6l7.6 1.5z" />
    </svg>
  );
}

function Row({ hidden }: { hidden?: boolean }) {
  return (
    <ul className="flex flex-none items-center" aria-hidden={hidden || undefined}>
      {GREETINGS.map((g) => (
        <li key={g.text} className="flex items-center">
          <span className={`px-7 text-[2.1rem] leading-none whitespace-nowrap sm:text-[2.6rem] ${g.font || "font-display italic"}`}>{g.text}</span>
          <Star className="h-5 w-5 flex-none text-saffron" />
        </li>
      ))}
    </ul>
  );
}

/** Two crossing ribbons of greetings in the three scripts, drifting slowly like a shop-front banner. */
export function Marquee() {
  return (
    <div className="relative my-4 py-10" aria-label="Hello, thank you and see you soon, in Tamil, Hindi and English" role="img">
      <div className="absolute inset-x-[-4%] top-1/2 h-16 -translate-y-[62%] rotate-[1.6deg] border-y-[2.5px] border-chai bg-saffron" />
      <div className="wm-marquee relative -rotate-[1.4deg] overflow-hidden border-y-[2.5px] border-chai bg-neel py-5 text-jasmine shadow-[0_6px_0_var(--color-chai)]">
        <div className="wm-marquee-track">
          <Row />
          <Row hidden />
        </div>
      </div>
    </div>
  );
}
