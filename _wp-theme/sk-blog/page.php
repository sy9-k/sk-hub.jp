<?php
/**
 * 固定ページ
 */
get_header();

while ( have_posts() ) :
	the_post();
	?>
<main id="main">
	<div class="sp-section">
		<div class="sp-wrap">
			<article <?php post_class( 'help-article help-article--page' ); ?>>
				<h1><?php the_title(); ?></h1>
				<div class="help-body entry"><?php the_content(); ?></div>
				<?php if ( comments_open() ) : ?>
					<?php comments_template(); ?>
				<?php endif; ?>
			</article>
		</div>
	</div>
</main>
	<?php
endwhile;

get_footer();
