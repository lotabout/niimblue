<script lang="ts">
  import { onMount } from "svelte";
  import MainPage from "$/components/MainPage.svelte";
  import { fontLibrary } from "$/stores/fonts";

  onMount(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden") void fontLibrary.refresh();
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  });
</script>

<MainPage />
