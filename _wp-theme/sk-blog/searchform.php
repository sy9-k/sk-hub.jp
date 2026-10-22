<form class="sp-search" role="search" method="get" action="<?php echo esc_url( home_url( '/' ) ); ?>">
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
	<input type="search" name="s" placeholder="記事を検索" value="<?php echo esc_attr( get_search_query() ); ?>" aria-label="記事を検索">
</form>
