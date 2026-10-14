import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { cn } from "./Button";

export type SelectOption = { value: string; label: string; disabled?: boolean };

/** `top` is measured from the viewport's bottom edge when the list opens above the trigger. */
type Placement = { left: number; top: number; width: number; maxHeight: number; above: boolean };

/**
 * A select-only combobox (WAI-ARIA 1.2 pattern) drawn in the site's own style, so the open list
 * matches the rest of the interface instead of the operating system's menu.
 * Focus stays on the trigger; the highlighted option is announced through aria-activedescendant.
 */
export function Select({
  value,
  onChange,
  options,
  label,
  placeholder = "請選擇",
  disabled = false,
  variant = "field",
  className,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Accessible name. The visible label next to the control should say the same thing. */
  label: string;
  placeholder?: string;
  disabled?: boolean;
  variant?: "field" | "pill" | "bare";
  className?: string;
  id?: string;
}) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  const enabled = (index: number) => index >= 0 && index < options.length && !options[index]!.disabled;
  const step = (from: number, direction: 1 | -1) => {
    for (let index = from + direction; index >= 0 && index < options.length; index += direction)
      if (enabled(index)) return index;
    return from;
  };
  const first = () => step(-1, 1);
  const last = () => step(options.length, -1);

  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 6;
    const below = window.innerHeight - rect.bottom - gap - 12;
    const above = rect.top - gap - 12;
    const wanted = Math.min(320, (list.current?.scrollHeight ?? 320) + 2);
    const flip = below < wanted && above > below;
    const width = Math.max(rect.width, 180);
    setPlacement({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: flip ? window.innerHeight - rect.top + gap : rect.bottom + gap,
      width,
      maxHeight: Math.max(120, Math.min(320, flip ? above : below)),
      above: flip,
    });
  }, []);

  const show = (index = selectedIndex >= 0 ? selectedIndex : first()) => {
    if (disabled) return;
    setActive(index);
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  const choose = (index: number) => {
    if (!enabled(index)) return;
    if (options[index]!.value !== value) onChange(options[index]!.value);
    close();
  };

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    place();
    const update = () => place();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !list.current?.contains(target)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, placement]);

  const typeahead = (key: string) => {
    const now = Date.now();
    typed.current = { text: now - typed.current.at > 600 ? key : typed.current.text + key, at: now };
    const query = typed.current.text.toLowerCase();
    const start = open ? active : selectedIndex;
    const order = [...options.keys()].map((offset) => (start + 1 + offset) % options.length);
    const match = order.find((index) => enabled(index) && options[index]!.label.toLowerCase().startsWith(query));
    if (match === undefined) return;
    if (open) setActive(match);
    else show(match);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const { key } = event;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(key)) {
        event.preventDefault();
        show(key === "ArrowUp" && selectedIndex < 0 ? last() : undefined);
      } else if (key === "Home" || key === "End") {
        event.preventDefault();
        show(key === "Home" ? first() : last());
      } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) typeahead(key);
      return;
    }
    const moves: Record<string, () => number> = {
      ArrowDown: () => step(active, 1),
      ArrowUp: () => step(active, -1),
      Home: first,
      End: last,
      PageDown: () => [...Array(10)].reduce<number>((index) => step(index, 1), active),
      PageUp: () => [...Array(10)].reduce<number>((index) => step(index, -1), active),
    };
    if (moves[key]) {
      event.preventDefault();
      setActive(moves[key]!());
    } else if (key === "Enter" || (key === " " && Date.now() - typed.current.at > 600)) {
      event.preventDefault();
      choose(active);
    } else if (key === "Escape") {
      event.preventDefault();
      close();
    } else if (key === "Tab") {
      close(false);
    } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      typeahead(key);
    }
  };

  const container = typeof document === "undefined" ? null : (trigger.current?.closest("dialog") ?? document.body);

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        disabled={disabled}
        className={cn("select-trigger", `select-trigger-${variant}`, className)}
        data-placeholder={selected ? undefined : ""}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{selected?.label ?? placeholder}</span>
        <ChevronDownIcon className="select-chevron" aria-hidden />
      </button>
      {open &&
        container &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            className="select-list"
            data-side={placement?.above ? "top" : "bottom"}
            style={
              placement
                ? {
                    left: placement.left,
                    [placement.above ? "bottom" : "top"]: placement.top,
                    minWidth: placement.width,
                    maxHeight: placement.maxHeight,
                  }
                : { visibility: "hidden" }
            }
          >
            {options.map((option, index) => (
              <li
                key={`${option.value}-${index}`}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === selectedIndex}
                aria-disabled={option.disabled || undefined}
                className={cn("select-option", index === active && "is-active")}
                onPointerMove={() => enabled(index) && index !== active && setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
              </li>
            ))}
          </ul>,
          container,
        )}
    </>
  );
}
