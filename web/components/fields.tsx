import type { ReactNode } from 'react';

interface ChoiceOption {
  value: string;
  label: string;
  hint?: string;
}

const CHOICE =
  'flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm transition hover:border-teal-300 has-[:checked]:border-teal-600 has-[:checked]:bg-teal-50/70 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-600/40';

export function Legend({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <legend className="mb-2">
      <span className="field-label">{children}</span>
      {hint ? <span className="field-hint block">{hint}</span> : null}
    </legend>
  );
}

export function RadioCards({
  name,
  options,
  value,
  columns = 'sm:grid-cols-2',
}: {
  name: string;
  options: readonly ChoiceOption[];
  value: string;
  columns?: string;
}) {
  return (
    <div className={`grid gap-2 ${columns}`}>
      {options.map((option) => (
        <label key={option.value} className={CHOICE}>
          <input
            type="radio"
            name={name}
            value={option.value}
            defaultChecked={value === option.value}
            className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700"
          />
          <span>
            <span className="font-medium text-stone-900">{option.label}</span>
            {option.hint ? <span className="block text-xs text-stone-500">{option.hint}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

export function CheckboxCards({
  name,
  options,
  values,
  columns = 'sm:grid-cols-2',
}: {
  name: string;
  options: readonly ChoiceOption[];
  values: readonly string[];
  columns?: string;
}) {
  return (
    <div className={`grid gap-2 ${columns}`}>
      {options.map((option) => (
        <label key={option.value} className={CHOICE}>
          <input
            type="checkbox"
            name={name}
            value={option.value}
            defaultChecked={values.includes(option.value)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700"
          />
          <span>
            <span className="font-medium text-stone-900">{option.label}</span>
            {option.hint ? <span className="block text-xs text-stone-500">{option.hint}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

/** 체크하면 name=1 로 보내는 단일 체크박스 */
export function FlagCard({ name, label, hint, checked }: { name: string; label: string; hint?: string; checked: boolean }) {
  return (
    <label className={CHOICE}>
      <input type="checkbox" name={name} value="1" defaultChecked={checked} className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700" />
      <span>
        <span className="font-medium text-stone-900">{label}</span>
        {hint ? <span className="block text-xs text-stone-500">{hint}</span> : null}
      </span>
    </label>
  );
}

/** 다른 칸의 값에 따라 보이는 묶음. CheckShell이 값이 바뀌면 바로 숨기거나 보인다. */
export function Conditional({
  field,
  values,
  current,
  children,
}: {
  field: string;
  values: readonly string[];
  current: string;
  children: ReactNode;
}) {
  const on = values.includes(current);
  return (
    <fieldset data-when-field={field} data-when-values={values.join(' ')} hidden={!on} disabled={!on}>
      {children}
    </fieldset>
  );
}

export function FormErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <ul className="list-disc space-y-1 pl-4">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}
