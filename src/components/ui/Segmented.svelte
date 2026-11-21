<script lang="ts" generics="T extends string | number">
  // A pick of one of a few (bot speed, animations): a row of radio buttons drawn as one control.
  let {
    label,
    options,
    value = $bindable(),
    onchange,
  }: { label: string; options: { value: T; label: string }[]; value: T; onchange?: () => void } = $props();
  const name = `seg-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="ui-seg">
  <span class="label" id={`${name}-l`}>{label}</span>
  <div class="row" role="radiogroup" aria-labelledby={`${name}-l`}>
    {#each options as o (o.value)}
      <label class:on={value === o.value}>
        <input type="radio" {name} value={o.value} checked={value === o.value} onchange={() => ((value = o.value), onchange?.())} />
        {o.label}
      </label>
    {/each}
  </div>
</div>

<style>
  .ui-seg {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label {
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
    font-weight: 500;
  }
  .row {
    display: flex;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--paper);
  }
  label {
    position: relative;
    flex: 1;
    display: grid;
    place-items: center;
    min-height: 32px;
    padding: 4px 12px;
    border-radius: 6px;
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color 0.3s var(--ease),
      color 0.3s var(--ease);
  }
  label:hover {
    color: var(--ink-strong);
  }
  label.on {
    background: var(--control);
    color: var(--ink-strong);
  }
  input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  label:has(input:focus-visible) {
    outline: 2px solid var(--ink-strong);
    outline-offset: 1px;
  }
  @media (pointer: coarse) {
    label {
      min-height: 40px;
    }
  }
</style>
