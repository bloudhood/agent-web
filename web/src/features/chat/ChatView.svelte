<script lang="ts">
  import ChatHeader from './ChatHeader.svelte';
  import MessageStream from './MessageStream.svelte';
  import Composer from './Composer.svelte';

  interface Props {
    onToggleSidebar?: () => void;
  }
  let { onToggleSidebar }: Props = $props();
</script>

<main class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
  <ChatHeader {onToggleSidebar} />
  <MessageStream />
  <Composer />
</main>
