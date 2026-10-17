<script lang="ts">
  import { onMount } from "svelte";
  import type { ExportedLabelTemplate } from "$/types";
  import { loadedFonts } from "$/stores/app";
  import { renderLabelPreview } from "$/utils/label_preview";

  let { label }: { label: ExportedLabelTemplate } = $props();
  let element: HTMLSpanElement;
  let visible = $state(false);
  let preview = $state<string>();

  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          visible = true;
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  });

  $effect(() => {
    const source = label;
    // Refresh if a custom font finishes loading after the library opens.
    void $loadedFonts;
    if (!visible) return;

    const controller = new AbortController();
    preview = undefined;
    renderLabelPreview(source, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) preview = result;
      })
      .catch((error) => {
        // Keep the stored thumbnail when an old/imported object cannot be rendered.
        if (!controller.signal.aborted) console.warn("Label preview could not be rendered", error);
      });
    return () => controller.abort();
  });
</script>

<span class="thumbnail" bind:this={element}>
  {#if preview || label.thumbnailBase64}
    <img src={preview || label.thumbnailBase64} alt="" />
  {/if}
</span>

<style>
  .thumbnail,
  img {
    display: block;
    width: 100%;
    height: 100%;
  }
  img {
    object-fit: contain;
  }
</style>
