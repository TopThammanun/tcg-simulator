<script lang="ts">
  // An on/off setting: the label on the left, the switch on the right, the whole row is the target.
  let { label, checked = $bindable(false), onchange }: { label: string; checked?: boolean; onchange?: () => void } = $props();
</script>

<label class="ui-switch">
  <span class="text">{label}</span>
  <input type="checkbox" role="switch" bind:checked {onchange} />
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
</label>

<style>
  .ui-switch {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 40px;
    color: var(--ink);
    font-size: 14px;
    line-height: 20px;
    cursor: pointer;
  }
  input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .track {
    position: relative;
    flex: none;
    width: 40px;
    height: 24px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--control);
    transition: background-color 0.3s var(--ease);
  }
  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--ink-soft);
    transition:
      transform 0.3s var(--ease),
      background-color 0.3s var(--ease);
  }
  input:checked + .track {
    border-color: var(--primary);
    background: var(--primary);
  }
  input:checked + .track .knob {
    background: var(--primary-ink);
    transform: translateX(16px);
  }
  input:focus-visible + .track {
    outline: 2px solid var(--ink-strong);
    outline-offset: 2px;
  }
  @media (pointer: coarse) {
    .ui-switch {
      min-height: 44px;
    }
  }
</style>
