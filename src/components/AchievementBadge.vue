<script setup>
defineProps({
  icon:     { type: String, required: true },
  label:    { type: String, required: true },
  desc:     { type: String, default: '' },
  unlocked: { type: Boolean, default: false },
  /** 'grid' (default) — compact badge for the Progress grid; 'inline' — slightly larger for session fanfares */
  variant:  { type: String, default: 'grid' },
})
</script>

<template>
  <div class="badge" :class="[variant, { unlocked }]">
    <span class="badge-icon">{{ icon }}</span>
    <span class="badge-label">{{ label }}</span>
    <span v-if="desc" class="badge-desc">{{ desc }}</span>
  </div>
</template>

<style scoped>
.badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  padding: 0.6rem 0.3rem;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  opacity: 0.35;
  transition: opacity 0.2s, border-color 0.2s;
}
.badge.unlocked {
  opacity: 1;
  border-color: var(--gold);
  background: color-mix(in srgb, var(--gold) 8%, var(--card));
}
.badge-icon {
  font-size: 1.5rem;
  line-height: 1;
}
.badge-label {
  font-size: 0.65rem;
  text-align: center;
  color: var(--muted);
  line-height: 1.2;
}
.badge.unlocked .badge-label {
  color: var(--text);
}
.badge-desc {
  font-size: 0.6rem;
  text-align: center;
  color: var(--muted);
  line-height: 1.3;
}
/* Slightly larger when shown inline in a session fanfare */
.badge.inline {
  padding: 0.5rem 0.7rem;
  border-radius: 12px;
  max-width: 10rem;
}
.badge.inline .badge-icon {
  font-size: 1.5rem;
}
.badge.inline .badge-label {
  font-size: 0.75rem;
}
.badge.inline .badge-desc {
  font-size: 0.7rem;
}
</style>
