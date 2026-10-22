<?php
/**
 * 404
 */
get_header();
?>
<main id="main">
	<section class="sp-hero sp-hero--compact">
		<div class="sp-wrap">
			<p class="sp-hero-kicker">404</p>
			<h1>ページが見つかりません</h1>
			<p class="sp-hero-lead">URL が間違っているか、記事が移動・削除された可能性があります。検索してみてください。</p>
			<?php get_search_form(); ?>
			<p class="btn-row btn-row--center"><a class="btn btn-ink" href="<?php echo esc_url( home_url( '/' ) ); ?>">トップへ戻る</a></p>
		</div>
	</section>
</main>
<?php
get_footer();
